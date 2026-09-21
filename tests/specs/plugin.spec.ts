import { execFile, spawn } from 'node:child_process';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = resolve(HERE, '../fixtures/run.js');
const APP = resolve(HERE, '../fixtures/app');
const ARTIFACT = resolve(APP, 'src/i18n-schema.d.ts');
const CATALOGUE = resolve(APP, 'src/lib/translations/home/en.json');

const CONFIG = { root: APP, config: 'src/lib/i18n.js' };

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
const build = async (options: Record<string, unknown> = {}): Promise<string> => {
  const { stdout, stderr } = await run(process.execPath, invoke({ mode: 'build', ...CONFIG, ...options }));

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

const serve = async (options: Record<string, unknown> = {}) => {
  const child = spawn(process.execPath, invoke({ mode: 'serve', ...CONFIG, ...options }), { stdio: ['ignore', 'pipe', 'pipe'] });

  await new Promise<void>((ready, failed) => {
    child.stdout.on('data', (chunk: Buffer) => { if (chunk.toString().includes('ready')) ready(); });
    child.on('exit', (code) => failed(new Error(`The dev server exited with ${code}.`)));
  });

  return {
    close: () => new Promise<void>((closed) => {
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

  it('leaves the app\'s own output alone', async () => {
    // The collection runs a second SvelteKit pipeline inside the first. Reusing
    // the outer build's plugin instances instead overwrites the config they
    // share, the adapter never runs, and the build still exits zero.
    await rm(resolve(APP, 'build'), { recursive: true, force: true });
    await build({ extractParams: CURLY });

    expect(await readFile(resolve(APP, 'build/index.js'), 'utf8')).toBeTruthy();
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

  it('rewrites nothing when the catalogues have not changed', async () => {
    // The artifact lands inside the tree the dev server watches, so an
    // unconditional write would announce a change and generate again.
    await build({ extractParams: CURLY });

    const { mtimeMs } = await stat(ARTIFACT);

    await build({ extractParams: CURLY });

    expect((await stat(ARTIFACT)).mtimeMs).toBe(mtimeMs);
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

  it('degrades to keys only when the extractor cannot be read', async () => {
    const output = await build({ extractParams: { from: 'sveltekit-i18n', name: 'notThere' } });

    expect(output).toContain('extractor-unreadable');
    expect(await artifact()).toContain("'home.greeting': any;");
  });
});

describe('a dev server', () => {
  it('generates on startup and answers a change to a catalogue', async () => {
    const original = await readFile(CATALOGUE, 'utf8');
    const server = await serve({ extractParams: CURLY });

    try {
      expect(await artifact()).toContain("'home.title': never;");

      await writeFile(CATALOGUE, `${JSON.stringify({ ...JSON.parse(original), added: 'A new one' }, null, 2)}\n`, 'utf8');
      await settle(async () => (await artifact()).includes("'home.added': never;"));
    } finally {
      await writeFile(CATALOGUE, original, 'utf8');
      await server.close();
    }
  });
});
