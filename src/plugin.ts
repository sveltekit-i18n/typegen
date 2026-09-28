import { access } from 'node:fs/promises';
import { isAbsolute, resolve as resolvePath, sep } from 'node:path';

import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';

import { collect } from './collect.js';
import type { Collected } from './collect.js';
import { emit, placeholder } from './emit.js';
import type { Collection, Diagnostic, Options } from './types.js';
import { writeIfChanged } from './write.js';

const NAME = 'sveltekit-i18n-typegen';

const DEFAULT_OUT_FILE = 'src/i18n-schema.d.ts';

// The codes that mean the key set cannot be trusted. Only the two extractor
// codes degrade — a payload stays unchecked, which is the keys-only mode this
// package ships anyway. An empty key set is not a degradation: it reads as an
// app with no translations, and writing it would erase a working schema.
const ERRORS = new Set<Diagnostic.Code>([
  'config-unreadable',
  'config-export-missing',
  'core-too-old',
  'reference-locale-missing',
  'loader-threw',
  'no-keys',
]);

const absolute = (root: string, path: string): string => (isAbsolute(path) ? path : resolvePath(root, path));

// Module ids are `/`-separated whatever the platform, while the watcher reports
// the paths the platform spells. One form has to win before they are compared.
const posix = (path: string): string => path.split(sep).join('/');

const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false);

// A throw carries whatever was thrown, which need not be an `Error` and need
// not stringify to anything useful. A skipped loader is expected to throw, for
// the route params it was not handed, so its stack is left out.
const explain = (cause: unknown, traced: boolean): string => {
  if (cause instanceof Error) return (traced ? cause.stack : undefined) ?? `${cause.name}: ${cause.message}`;

  try {
    return JSON.stringify(cause) ?? Object.prototype.toString.call(cause);
  } catch {
    return Object.prototype.toString.call(cause);
  }
};

// One build resolves its config once and starts an environment per target, so
// `buildStart` arrives more than once for the same work. Keyed by the config
// object rather than by a flag, so a second build in the same process — a
// programmatic one — generates again; a watcher's next round keeps the config
// and clears its entry instead.
const generated = new WeakSet<ResolvedConfig>();

// The artifacts a build is generating. SvelteKit builds its client inside the
// server build, from the config file loaded again, so a second instance of the
// plugin starts while the first one's build is still open. Held on the global
// because loading the config file again can load this module again too.
const REGISTRY = Symbol.for('sveltekit-i18n-typegen:building');

const building = ((globalThis as Record<symbol, unknown>)[REGISTRY] ??= new Set<string>()) as Set<string>;

// Called from this plugin's own `buildStart` for the client, so the start is
// Vite's and under way; once this call has returned it can be joined. Vite loads its
// optimizers the moment it is over, and reports a start that failed itself; a
// bundled dev server starts the client through its bundler and has loaded them
// already.
const started = async (server: ViteDevServer): Promise<boolean> => {
  await Promise.resolve();

  if (!server.config.experimental.bundledDev) {
    try {
      await server.environments.client?.pluginContainer.buildStart();
    } catch {
      return false;
    }
  }

  await new Promise((next) => { setTimeout(next, 0); });

  return true;
};

type Generated = { dependencies: string[]; failed: boolean };

type Report = (severity: Diagnostic.Severity, message: string, cause?: unknown, traced?: boolean) => void;

const report = (collection: Collection, log: Report): boolean => {
  const failed = collection.diagnostics.some(({ code }) => ERRORS.has(code));

  collection.diagnostics.forEach(({ code, message, cause }) => {
    log(ERRORS.has(code) ? 'error' : 'warning', `${message} [${code}]`, cause, code !== 'loader-skipped');
  });

  return !failed;
};

/**
 * Generates the `TranslationSchema` type from the app's own translation files.
 *
 * The key set cannot be read off the catalogues: loaders are functions, a
 * `namespace` prefixes its data at runtime and `preprocess` reshapes what
 * lands. So the config is EVALUATED, inside the app's own Vite pipeline, and
 * the keys are read back off the core the app itself would build.
 */
export const typegen = (options: Options.T): Plugin => {
  const settings = {
    configExport: 'config',
    outFile: DEFAULT_OUT_FILE,
    enabled: true,
    ...options,
  };

  let resolved: ResolvedConfig;
  let outFile: string;
  let claimed = false;
  // Set by a dev server, for its client's start.
  let start: (() => void) | undefined;

  // Released once the claiming build is over, so the next one generates again.
  const release = (): void => {
    if (!claimed) return;

    building.delete(outFile);
    claimed = false;
  };

  const write = async (contents: string, log: Report): Promise<boolean> => {
    try {
      await writeIfChanged(outFile, contents);

      return true;
    } catch (cause) {
      log('error', `Could not write '${settings.outFile}'.`, cause);

      return false;
    }
  };

  // `live` answers whether the server it runs for still serves: one that
  // restarted has a successor writing the same file. `reached` hears what the
  // generation reached and whether it failed, unless it never got as far as
  // the app, and hears it before the artifact is written: whoever watches
  // those files has them watched by the time the artifact tells a change.
  const generate = async (log: Report, live = (): boolean => true, reached?: (generated: Generated) => void): Promise<void> => {
    // Written before anything else. An empty interface degrades to plain
    // `string` keys, so a project compiles both before the first generation
    // and after a failed one; without it a cold clone cannot even typecheck.
    if (!await exists(outFile) && !(live() && await write(placeholder(), log))) return;

    let collected: Collected;

    try {
      collected = await collect({ options: settings, resolved });
    } catch (cause) {
      if (live()) log('error', `Could not read '${settings.config}'. [config-unreadable]`, cause);

      return;
    }

    if (!live()) return;

    // A generation that failed answers to everything it loaded: a catalogue
    // a loader could not transform is not among what it evaluated.
    if ('cause' in collected) {
      log('error', `Could not read '${settings.config}'. [config-unreadable]`, collected.cause);
      reached?.({ dependencies: collected.reached, failed: true });

      return;
    }

    // A key set short of the real one is worse than none: the types would
    // claim a key exists, or hide one that does, and the runtime would
    // disagree. On an error the previous artifact stands.
    if (!report(collected.collection, log)) {
      reached?.({ dependencies: collected.reached, failed: true });

      return;
    }

    const { entries, referenceLocale, skipped } = collected.collection;

    reached?.({ dependencies: collected.dependencies, failed: false });
    await write(emit(entries, referenceLocale, skipped).contents, log);
  };

  return {
    name: NAME,

    configResolved(config) {
      resolved = config;
      outFile = absolute(config.root, settings.outFile);
    },

    async buildStart() {
      if (resolved.command === 'serve' && this.environment?.name === 'client') start?.();

      if (!settings.enabled || resolved.command !== 'build' || generated.has(resolved) || building.has(outFile)) return;

      generated.add(resolved);
      building.add(outFile);
      claimed = true;

      // Reported, never thrown. The artifact is types: a build that cannot be
      // typed still deploys, and the placeholder keeps the project compiling.
      // Making a deploy hinge on a loader that blinked would be the worse
      // trade, and a CI freshness gate is the right place for strictness.
      await generate((_severity, message, cause, traced = true) => {
        this.warn(cause === undefined ? message : `${message}\n${explain(cause, traced)}`);
      });
    },

    buildEnd(error) {
      if (error) release();
    },

    // Ahead of the other plugins' `closeBundle`: one that throws, an adapter
    // failing, stops the ones after it.
    closeBundle: { order: 'pre', handler: release },

    // The watcher's next change starts the next round, on the same config; a
    // round that failed while writing its bundle never closed it.
    watchChange() {
      generated.delete(resolved);
      release();
    },

    closeWatcher: release,

    configureServer(server) {
      if (!settings.enabled) return;

      const log: Report = (severity, message, cause, traced = true) => {
        const level = severity === 'error' ? 'error' : 'warn';

        server.config.logger[level](`[${NAME}] ${message}`);

        if (cause !== undefined) server.config.logger[level](explain(cause, traced));
      };

      const generatedId = posix(outFile);
      // Answered whatever the last generation reached: one that could not
      // find it reached nothing of it.
      const configId = posix(absolute(resolved.root, settings.config));

      // What a regeneration answers to besides the config: every catalogue
      // the loaders actually reached, the other locales' included, a linked
      // workspace package's outside the root too. The artifact itself is left
      // out — it lands inside the tree the server watches — and so is a
      // specifier that never resolved to a file.
      const watched = new Set<string>();
      const answers = (id: string): boolean => id === configId || watched.has(id);

      // What changed while a generation was queued or running, which may have
      // read it before the change — a file it reaches for the first time
      // included, which no watch set names yet.
      const touched = new Set<string>();
      let queued = 0;

      const changed = (path: string): void => {
        const id = posix(path);

        if (answers(id)) void regenerate();
        else if (queued) touched.add(id);
      };

      // A watcher drops its listeners the moment it starts to close, and
      // adding to a closed one opens it again, with the process. Each server
      // has a watcher of its own, so this answers for this server alone.
      const serving = (): boolean => server.watcher.listeners('change').includes(changed);

      // Only a generation that did not fail narrows the set: one that failed
      // may never have reached the file whose next change fixes it.
      const remember = ({ dependencies, failed }: Generated): void => {
        if (!serving()) return;

        if (!failed) watched.clear();

        dependencies
          .filter((id) => isAbsolute(id) && id !== generatedId)
          .forEach((id) => watched.add(id));

        server.watcher.add([...watched]);

        const missed = [...touched].some(answers);

        touched.clear();

        if (missed) void regenerate();
      };

      // Saving a whole editor session changes several files at once, and each
      // generation runs a Vite pipeline of its own. Chaining them is what keeps
      // the last write the last one to have been derived.
      let pending = Promise.resolve();

      const regenerate = (): Promise<void> => {
        queued += 1;
        pending = pending.then(async () => {
          try {
            if (serving()) await generate(log, serving, remember);
          } finally {
            queued -= 1;
          }
        });

        return pending;
      };

      // A file a failed generation could not find, or one a branch switch
      // removes, comes back as an addition.
      server.watcher.on('change', changed);
      server.watcher.on('add', changed);
      server.watcher.on('unlink', changed);

      // Once the server has started its own pre-bundling: the first cache a
      // process loads is the one whose stale directories Vite clears. It does
      // that the moment the client's plugins have started, which Vite does on
      // `listen()`, or once it is created behind a framework's server.
      start = () => {
        start = undefined;
        void started(server).then((ready) => (ready ? regenerate() : undefined));
      };
    },
  };
};
