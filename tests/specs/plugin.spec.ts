import { execFile, spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = resolve(HERE, '../fixtures/run.js');
const APP = resolve(HERE, '../fixtures/app');
const ARTIFACT = resolve(APP, 'src/i18n-schema.d.ts');
const CATALOGUE = resolve(APP, 'src/lib/translations/home/en.json');

const CONFIG = { root: APP, config: 'src/lib/i18n.js' };

const LINKED = resolve(HERE, '../fixtures/linked');
const MODULES = resolve(APP, 'node_modules');
const CATALOGUE_PACKAGE = resolve(HERE, '../fixtures/catalogue');

// The extractor the app's own parser ships, named the way an app names it.
const CURLY = { from: 'sveltekit-i18n' };

const invoke = (payload: Record<string, unknown>): string[] => [RUNNER, JSON.stringify(payload)];

/**
 * One build of the fixture app, in a process of its own.
 *
 * The plugin's work happens inside a nested pipeline of SvelteKit's own
 * plugins, which keep module-level state — two builds in one process would not
 * be independent, and the outer build is half of what is being asserted.
 */
const build = async (options: Record<string, unknown> = {}, env: Record<string, string> = {}): Promise<string> => {
  const { stdout, stderr } = await run(process.execPath, invoke({ mode: 'build', ...CONFIG, ...options }), { env: { ...process.env, ...env } });

  return `${stdout}\n${stderr}`;
};

const artifact = (): Promise<string> => readFile(ARTIFACT, 'utf8');

const missing = async (): Promise<boolean> => !await artifact().catch(() => '');

const settle = async (condition: () => Promise<boolean>): Promise<void> => {
  const deadline = Date.now() + 30_000;

  // The watcher offers nothing to await, so the state it changes is what gets
  // waited on — with a deadline, so a regression fails instead of hanging.
  while (Date.now() < deadline) {
    if (await condition()) return;

    await new Promise((settled) => setTimeout(settled, 25));
  }

  throw new Error('The dev server never regenerated.');
};

const serve = async (options: Record<string, unknown> = {}, env: Record<string, string> = {}) => {
  const child = spawn(process.execPath, invoke({ mode: 'serve', ...CONFIG, ...options }), { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });

  let output = '';

  child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });

  await new Promise<void>((ready, failed) => {
    child.stdout.on('data', (chunk: Buffer) => { if (chunk.toString().includes('ready')) ready(); });
    child.on('exit', (code) => failed(new Error(`The dev server exited with ${code}.`)));
  });

  return {
    output: () => output,
    close: () => new Promise<void>((closed) => {
      if (child.exitCode !== null) return closed();

      child.on('exit', () => closed());
      child.kill('SIGTERM');
    }),
  };
};

beforeEach(() => rm(ARTIFACT, { force: true }));
afterEach(() => rm(ARTIFACT, { force: true }));

describe('a production build', () => {
  it('writes the keys the app would hold, with the payloads its parser reports', async () => {
    await build({ extractParams: CURLY });

    const contents = await artifact();

    // A namespace key, a preprocessed array index, a key that is not an
    // identifier, and the static table — none of which a glob over the
    // catalogues could have produced.
    expect(contents).toContain("'home.title': never;");
    expect(contents).toContain("'home.bullets.0': never;");
    expect(contents).toContain("'home.odd key': never;");
    expect(contents).toContain("'lang.en': never;");
    expect(contents).toContain('count: number;');
    expect(contents).toContain('name: unknown;');
    expect(contents).toContain('gender?: unknown;');
  });

  it('finds nothing to report when the locales agree', async () => {
    const output = await build({ extractParams: CURLY });

    expect(output).not.toContain('[key-');
    expect(output).not.toContain('[locale-unchecked]');
  });

  it('leaves the app\'s own output alone', async () => {
    // The collection runs a second SvelteKit pipeline inside the first. Reusing
    // the outer build's plugin instances instead overwrites the config they
    // share, the adapter never runs, and the build still exits zero.
    await rm(resolve(APP, 'build'), { recursive: true, force: true });
    const output = await build({ extractParams: CURLY });

    expect(await readFile(resolve(APP, 'build/index.js'), 'utf8')).toBeTruthy();
    expect(output).not.toContain('fetch was replaced');
  });

  it('derives only the reference locale', async () => {
    await build({ extractParams: CURLY, referenceLocale: 'cs' });

    expect(await artifact()).toContain('Reference locale: cs');
  });

  it('reads the app the way a production build would', async () => {
    // The collection runs inside a module runner, which always resolves as a
    // dev server. A config branching on `dev` would otherwise be typed from
    // the keys the app only has while developing.
    await build({ configExport: 'branching' });

    expect(await artifact()).toContain('/** in production */');
  });

  it('reads a config module that builds its instance from sveltekit-i18n', async () => {
    const output = await build({ config: 'src/lib/instance.js' });

    expect(output).not.toContain('[config-unreadable]');
    expect(await artifact()).toContain("'home.title': any;");
  });

  it('reads a config whose core the app pre-bundles for its server', async () => {
    // Pre-bundled, the core's rune modules are compiled by the Svelte plugin
    // on the way into the bundle; loaded as they ship, they would not run.
    const output = await build({ config: 'src/lib/instance.js', vite: { ssr: { optimizeDeps: { include: ['sveltekit-i18n'] } } } });

    expect(output).not.toContain('[config-unreadable]');
    expect(await artifact()).toContain("'home.title': any;");
  });

  it('reads the core a pre-bundled sveltekit-i18n depends on', async () => {
    // A copy of another version at the app root, where a bundle in the cache
    // would resolve the core from.
    const stray = resolve(MODULES, '@sveltekit-i18n/base');

    await mkdir(stray, { recursive: true });
    await writeFile(resolve(stray, 'package.json'), JSON.stringify({ name: '@sveltekit-i18n/base', type: 'module', exports: { '.': './index.js', './utils': './utils.js' } }), 'utf8');
    await writeFile(resolve(stray, 'index.js'), 'export class I18n {}\n', 'utf8');
    await writeFile(resolve(stray, 'utils.js'), 'export {};\n', 'utf8');

    try {
      const output = await build({ config: 'src/lib/instance.js', vite: { ssr: { optimizeDeps: { include: ['sveltekit-i18n'] } } } });

      expect(output).not.toContain('[core-too-old]');
      expect(await artifact()).toContain("'home.title': any;");
    } finally {
      await rm(resolve(MODULES, '@sveltekit-i18n'), { recursive: true, force: true });
    }
  });

  it('reads the config in the mode the build runs in', async () => {
    await build({ configExport: 'moded', vite: { mode: 'staging' } });

    expect(await artifact()).toContain("'mode.staging': any;");
  });

  it('reads a module one of the app\'s own plugins serves', async () => {
    const output = await build({ configFile: 'vite.typegen.config.js', config: 'src/lib/served.js' }, { TYPEGEN_FIXTURE: 'served' });

    expect(output).not.toContain('[config-unreadable]');
    expect(await artifact()).toContain("'home.title': any;");
  });

  it('leaves the app\'s own compile warnings on', async () => {
    const output = await build();

    // Once for the server build, once for the client build.
    expect(output.match(/a11y_missing_attribute/g)).toHaveLength(2);
  });

  it('pre-bundles into a cache of its own when the app\'s cannot be written', async () => {
    const blocked = resolve(MODULES, '.vite/typegen');

    await rm(blocked, { recursive: true, force: true });
    await mkdir(dirname(blocked), { recursive: true });
    await writeFile(blocked, '', 'utf8');

    try {
      const output = await build({ config: 'src/lib/instance.js' });

      expect(output).not.toContain('[config-unreadable]');
      expect(await artifact()).toContain("'home.title': any;");
    } finally {
      await rm(blocked, { force: true });
    }
  });

  it('hands a route-scoped loader a route it could have run on', async () => {
    // An empty string is not a route any app visits: a loader that reads one
    // can throw, and one that derives keys from it derives the wrong ones.
    await build({ configExport: 'routed' });

    expect(await artifact()).toContain('/** /deep/page */');
  });

  it('leaves the payload unchecked when no extractor is named', async () => {
    await build();

    const contents = await artifact();

    expect(contents).toContain("'home.greeting': any;");
    expect(contents).not.toContain('name: unknown;');
  });

  it('generates nothing when it is turned off', async () => {
    await build({ enabled: false });

    expect(await missing()).toBe(true);
  });

  it('collects once per build of an app that carries it in its config file', async () => {
    // SvelteKit loads the config file again for its client build, nested in
    // the server build, which builds a second instance of the plugin.
    const marks = resolve(await mkdtemp(resolve(tmpdir(), 'typegen-')), 'marks');

    try {
      await build({ configFile: 'vite.typegen.config.js', config: 'src/lib/counted.js' }, { TYPEGEN_COUNT: marks });

      expect(await readFile(marks, 'utf8')).toBe('x');
    } finally {
      await rm(dirname(marks), { recursive: true, force: true });
    }
  });

  it('rewrites nothing when the catalogues have not changed', async () => {
    // The artifact lands inside the tree the dev server watches, so an
    // unconditional write would announce a change and generate again.
    await build({ extractParams: CURLY });

    const { mtimeMs } = await stat(ARTIFACT);

    await build({ extractParams: CURLY });

    expect((await stat(ARTIFACT)).mtimeMs).toBe(mtimeMs);
  });
});

describe('a config in a linked workspace package', () => {
  // Two copies of one package, each naming itself: the app's own and the one
  // nested under the workspace package, which only `resolve.dedupe` passes
  // over.
  const copy = async (directory: string, name: string): Promise<void> => {
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, 'package.json'), JSON.stringify({ name: 'which-copy', type: 'module', exports: './index.js' }), 'utf8');
    await writeFile(resolve(directory, 'index.js'), `export default '${name}';\n`, 'utf8');
  };

  const cleanup = () => Promise.all([
    rm(resolve(MODULES, '@fixture'), { recursive: true, force: true }),
    rm(resolve(MODULES, 'which-copy'), { recursive: true, force: true }),
    rm(resolve(LINKED, 'node_modules'), { recursive: true, force: true }),
  ]);

  beforeAll(async () => {
    await cleanup();
    await mkdir(resolve(MODULES, '@fixture'), { recursive: true });
    // A junction links a directory on Windows without elevated rights.
    await symlink(LINKED, resolve(MODULES, '@fixture/i18n'), 'junction');
    await symlink(CATALOGUE_PACKAGE, resolve(MODULES, '@fixture/catalogue'), 'junction');
    await copy(resolve(MODULES, 'which-copy'), 'root');
    await copy(resolve(LINKED, 'node_modules/which-copy'), 'nested');
  });

  afterAll(cleanup);

  it('reads it through the app\'s pipeline, as the app\'s own build does', async () => {
    // Vite inlines a linked package for the app; were it externalized here,
    // the core it builds its instance from would run uncompiled.
    const output = await build({ config: 'src/lib/linked.js' });

    expect(output).not.toContain('[config-unreadable]');
    expect(await artifact()).toContain("'home.title': any;");
  });

  it('answers a change to it on a dev server', async () => {
    const source = resolve(LINKED, 'index.js');
    const original = await readFile(source, 'utf8');
    const server = await serve({ config: 'src/lib/linked.js' });

    try {
      await settle(async () => (await artifact().catch(() => '')).includes("'home.title': any;"));

      // A file outside the root is watched once the generation that reached
      // it says so, and chokidar starts a watch asynchronously: the edit is
      // repeated, a second apart, until one is heard.
      const edited = original.replace("{ title: 'Linked' }", "{ title: 'Linked', extra: 'More' }");
      let saved = 0;

      await settle(async () => {
        if (Date.now() - saved > 1_000) {
          saved = Date.now();
          await writeFile(source, edited, 'utf8');
        }

        return (await artifact()).includes("'home.extra': any;");
      });
    } finally {
      await writeFile(source, original, 'utf8');
      await server.close();
    }
  });

  it('resolves its dependencies the way the app does', async () => {
    await build({ config: 'src/lib/linked.js', vite: { resolve: { dedupe: ['which-copy'] } } });

    expect(await artifact()).toContain('Reference locale: root');
  });

  it('reports a CommonJS one the app\'s own server could not load either', async () => {
    const output = await build({ config: 'src/lib/catalogue.js' });

    expect(output).toContain('[config-unreadable]');
  });

  it('reads one the app pre-bundles for its server', async () => {
    const output = await build({ config: 'src/lib/linked.js', vite: { ssr: { optimizeDeps: { include: ['@fixture/i18n'] } } } });

    expect(output).not.toContain('[config-unreadable]');
    expect(await artifact()).toContain("'home.title': any;");
  });

  it('loads a CommonJS one the app pre-bundles for its server', async () => {
    const output = await build({ config: 'src/lib/catalogue.js', vite: { ssr: { optimizeDeps: { include: ['@fixture/catalogue'] } } } });

    expect(output).not.toContain('[config-unreadable]');
    expect(await artifact()).toContain("'home.title': any;");
  });
});

describe('a build that cannot derive the keys', () => {
  const STALE = '// stale\ninterface TranslationSchema { stale: never }\n';

  it('reports a config it cannot read, and still deploys', async () => {
    const output = await build({ config: 'src/lib/nowhere.js' });

    expect(output).toContain('config-unreadable');
    // The placeholder, so a project whose first generation failed still
    // compiles — with plain `string` keys, which is base's documented degrade.
    expect(await artifact()).toContain('interface TranslationSchema {}');
  });

  it('reports why the app\'s server environment would not start', async () => {
    const output = await build({ configFile: 'vite.typegen.config.js' }, { TYPEGEN_FIXTURE: 'refuse' });

    expect(output).toContain('[config-unreadable]');
    expect(output).toContain('Refused while serving.');
  });

  it('finishes a build whose loader never settles', async () => {
    const output = await build({ configFile: 'vite.typegen.config.js', config: 'src/lib/never.js' }, { TYPEGEN_FIXTURE: 'never' });

    expect(output).toContain('[loader-threw]');
  });

  it('reports an artifact it cannot write as that', async () => {
    const blocked = resolve(APP, 'src/blocked.d.ts');

    await mkdir(blocked, { recursive: true });

    try {
      const output = await build({ outFile: 'src/blocked.d.ts' });

      expect(output).toContain("Could not write 'src/blocked.d.ts'.");
      expect(output).not.toContain('[config-unreadable]');
    } finally {
      await rm(blocked, { recursive: true, force: true });
    }
  });

  it('reports a config export that is not there, and names the ones that are', async () => {
    const output = await build({ configExport: 'nope' });

    expect(output).toContain('config-export-missing');
    expect(output).toContain("'config'");
  });

  it('reports a config that names no locale', async () => {
    const output = await build({ configExport: 'nameless' });

    expect(output).toContain('reference-locale-missing');
  });

  it('keeps the last good artifact when a loader throws', async () => {
    // The core swallows a throwing loader to keep a page rendering. A key set
    // quietly short of the real one would instead make the types lie, so the
    // previous artifact stands.
    await writeFile(ARTIFACT, STALE, 'utf8');

    const output = await build({ configExport: 'throwing', extractParams: CURLY });

    expect(output).toContain('loader-threw');
    expect(await artifact()).toBe(STALE);
  });

  it('compares the other locales, and writes the schema whatever they lack', async () => {
    const output = await build({ configExport: 'partial' });

    expect(output).toContain("'cs' lacks 6 keys the reference 'en' has: 'home.bullets.0', 'home.bullets.1', 'home.choice', 'home.count', 'home.greeting', 'home.odd key'. [key-missing]");
    expect(output).toContain("'cs' has 1 key 'en' lacks, so no type names them: 'home.extra'. [key-extra]");
    expect(await artifact()).toContain("'home.greeting': any;");
  });

  it('writes the schema when another locale\'s loader throws', async () => {
    const output = await build({ configExport: 'unchecked' });

    expect(output).toContain("The 'cs' > 'gone' loader threw, so 'cs' was not compared with 'en'. [locale-unchecked]");
    expect(await artifact()).toContain("'home.title': any;");
  });

  it('reads a loader that lists its locales through the app\'s core', async () => {
    const output = await build({ configExport: 'listed' });

    expect(output).not.toContain('[key-');
    expect(await artifact()).toContain("'home.title': any;");
    expect(await artifact()).toContain("'about.title': any;");
  });

  it('reads the tables where a custom sanitizeLocales files them', async () => {
    const output = await build({ configExport: 'sanitized' });

    expect(output).not.toContain('[no-keys]');
    expect(await artifact()).toContain('Reference locale: en-US');
    expect(await artifact()).toContain("'home.title': any;");
    expect(await artifact()).toContain("'lang.en': any;");
  });

  it('degrades to keys only when the extractor cannot be read', async () => {
    const output = await build({ extractParams: { from: 'sveltekit-i18n', name: 'notThere' } });

    expect(output).toContain('extractor-unreadable');
    expect(await artifact()).toContain("'home.greeting': any;");
  });
});

describe('a dev server', () => {
  it('leaves a server that fails to start to the framework that runs it', async () => {
    const { stdout } = await run(process.execPath, invoke({ mode: 'serve', ...CONFIG, neighbours: ['failing'] }));

    expect(stdout).toContain('caught: Failed to start.');
    expect(stdout).toContain('survived');
  });

  it('never starts the client\'s plugins of a server that failed to set up', async () => {
    const { stdout } = await run(process.execPath, invoke({ mode: 'serve', ...CONFIG, neighbours: ['counted', 'failingLate'] }));

    expect(stdout).toContain('caught: Failed to set up.');
    expect(stdout).not.toContain('client started');
  });

  it('starts the client\'s plugins of a bundled dev server once', async () => {
    const { stdout } = await run(process.execPath, invoke({ mode: 'serve', ...CONFIG, close: true, neighbours: ['counted'], vite: { experimental: { bundledDev: true } } }));

    expect(stdout.match(/client started/g)).toHaveLength(1);
  });

  it('lets the process end once the server is closed', async () => {
    // A generation that settles after the close would open the watcher again.
    const { stdout } = await run(process.execPath, invoke({ mode: 'serve', ...CONFIG, close: true }), { timeout: 60_000, killSignal: 'SIGKILL' });

    expect(stdout).toContain('closed');
  });

  it('lets the process end once a server that takes its time is closed', async () => {
    const { stdout } = await run(process.execPath, invoke({ mode: 'serve', ...CONFIG, close: true, neighbours: ['slowClose'] }), { timeout: 60_000, killSignal: 'SIGKILL' });

    expect(stdout).toContain('closed');
  });

  it('answers a change to a catalogue a generation read before it changed', async () => {
    const original = await readFile(CATALOGUE, 'utf8');
    const gate = resolve(await mkdtemp(resolve(tmpdir(), 'typegen-')), 'gate');
    const server = await serve({ configExport: 'gated' }, { TYPEGEN_GATE: gate });
    const exists = (path: string) => access(path).then(() => true, () => false);

    try {
      await settle(() => exists(`${gate}.read`));
      await writeFile(CATALOGUE, `${JSON.stringify({ ...JSON.parse(original), added: 'A new one' }, null, 2)}\n`, 'utf8');
      await writeFile(`${gate}.go`, '', 'utf8');
      await settle(async () => (await artifact().catch(() => '')).includes("'home.added': any;"));
    } finally {
      await writeFile(CATALOGUE, original, 'utf8');
      await server.close();
      await rm(dirname(gate), { recursive: true, force: true });
    }
  });

  it('answers a change to a catalogue after the server restarts', async () => {
    const original = await readFile(CATALOGUE, 'utf8');
    const server = await serve({ extractParams: CURLY, restart: true });

    try {
      await settle(async () => (await artifact().catch(() => '')).includes("'home.title': never;"));
      await writeFile(CATALOGUE, `${JSON.stringify({ ...JSON.parse(original), added: 'A new one' }, null, 2)}\n`, 'utf8');
      await settle(async () => (await artifact()).includes("'home.added': never;"));
    } finally {
      await writeFile(CATALOGUE, original, 'utf8');
      await server.close();
    }
  });

  it('answers a change to a catalogue a loader could not read', async () => {
    const original = await readFile(CATALOGUE, 'utf8');
    const server = await serve({ extractParams: CURLY });

    try {
      await settle(async () => (await artifact().catch(() => '')).includes("'home.title': never;"));
      await writeFile(CATALOGUE, '{', 'utf8');
      await settle(async () => server.output().includes('[loader-threw]'));
      await writeFile(CATALOGUE, `${JSON.stringify({ ...JSON.parse(original), added: 'A new one' }, null, 2)}\n`, 'utf8');
      await settle(async () => (await artifact()).includes("'home.added': never;"));
    } finally {
      await writeFile(CATALOGUE, original, 'utf8');
      await server.close();
    }
  });

  it('answers a change to a config it could not read', async () => {
    const config = resolve(APP, 'src/lib/unreadable.js');

    await writeFile(config, 'export const config = ;\n', 'utf8');

    const server = await serve({ config: 'src/lib/unreadable.js', extractParams: CURLY });

    try {
      await settle(async () => server.output().includes('[config-unreadable]'));
      await writeFile(config, "export { config } from './i18n.js';\n", 'utf8');
      await settle(async () => (await artifact().catch(() => '')).includes("'home.title': never;"));
    } finally {
      await server.close();
      await rm(config, { force: true });
    }
  });

  it('answers a catalogue a loader could not read from the start', async () => {
    const original = await readFile(CATALOGUE, 'utf8');
    let server: Awaited<ReturnType<typeof serve>> | undefined;

    try {
      await writeFile(CATALOGUE, '{', 'utf8');
      server = await serve({ extractParams: CURLY });
      await settle(async () => server!.output().includes('[loader-threw]'));
      await writeFile(CATALOGUE, original, 'utf8');
      await settle(async () => (await artifact().catch(() => '')).includes("'home.title': never;"));
    } finally {
      await writeFile(CATALOGUE, original, 'utf8');
      await server?.close();
    }
  });

  it('answers a catalogue that is removed and comes back', async () => {
    const original = await readFile(CATALOGUE, 'utf8');
    const server = await serve({ extractParams: CURLY });

    try {
      await settle(async () => (await artifact().catch(() => '')).includes("'home.title': never;"));
      await rm(CATALOGUE);
      await settle(async () => server.output().includes('[loader-threw]'));
      await writeFile(CATALOGUE, `${JSON.stringify({ ...JSON.parse(original), added: 'A new one' }, null, 2)}\n`, 'utf8');
      await settle(async () => (await artifact()).includes("'home.added': never;"));
    } finally {
      await writeFile(CATALOGUE, original, 'utf8');
      await server.close();
    }
  });

  it('answers a config that is not there yet once it is', async () => {
    const config = resolve(APP, 'src/lib/later.js');
    const server = await serve({ config: 'src/lib/later.js', extractParams: CURLY });

    try {
      await settle(async () => server.output().includes('[config-unreadable]'));
      await writeFile(config, "export { config } from './i18n.js';\n", 'utf8');
      await settle(async () => (await artifact().catch(() => '')).includes("'home.title': never;"));
    } finally {
      await server.close();
      await rm(config, { force: true });
    }
  });

  it('reports an artifact it cannot write, and keeps serving', async () => {
    const server = await serve({ outFile: 'package.json/i18n-schema.d.ts' });

    try {
      await settle(async () => server.output().includes("Could not write 'package.json/i18n-schema.d.ts'."));
    } finally {
      await server.close();
    }
  });

  it('generates on startup and answers a change to a catalogue', async () => {
    const original = await readFile(CATALOGUE, 'utf8');
    const server = await serve({ extractParams: CURLY });

    try {
      await settle(async () => (await artifact().catch(() => '')).includes("'home.title': never;"));

      await writeFile(CATALOGUE, `${JSON.stringify({ ...JSON.parse(original), added: 'A new one' }, null, 2)}\n`, 'utf8');
      await settle(async () => (await artifact()).includes("'home.added': never;"));
    } finally {
      await writeFile(CATALOGUE, original, 'utf8');
      await server.close();
    }
  });

  it.each([
    { listen: false },
    { listen: true },
    { listen: false, neighbours: ['slow'] },
  ])('leaves the app\'s own pre-bundling cache to the app (%o)', async (options) => {
    // A server clears the stale directories of the first cache it loads, once
    // per process. Collecting first would claim that for a cache of its own.
    const stale = resolve(MODULES, '.vite/deps_temp_stale');

    await mkdir(stale, { recursive: true });
    await utimes(stale, 0, 0);

    const server = await serve(options);

    try {
      await settle(async () => !await missing() && !await access(stale).then(() => true, () => false));
    } finally {
      await rm(stale, { recursive: true, force: true });
      await server.close();
    }
  });
});
