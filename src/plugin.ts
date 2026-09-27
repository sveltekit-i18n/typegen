import { access } from 'node:fs/promises';
import { isAbsolute, resolve as resolvePath, sep } from 'node:path';

import type { Plugin, ResolvedConfig } from 'vite';

import { collect } from './collect.js';
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
// not stringify to anything useful.
const explain = (cause: unknown): string => {
  if (cause instanceof Error) return cause.stack ?? `${cause.name}: ${cause.message}`;

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

type Report = (severity: Diagnostic.Severity, message: string, cause?: unknown) => void;

const report = (collection: Collection, log: Report): boolean => {
  const failed = collection.diagnostics.some(({ code }) => ERRORS.has(code));

  collection.diagnostics.forEach(({ code, message, cause }) => {
    log(ERRORS.has(code) ? 'error' : 'warning', `${message} [${code}]`, cause);
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

  // Released once the claiming build is over, so the next one generates again.
  const release = (): void => {
    if (!claimed) return;

    building.delete(outFile);
    claimed = false;
  };

  const generate = async (log: Report): Promise<string[]> => {
    // Written before anything that can throw. An empty interface degrades to
    // plain `string` keys, so a project compiles both before the first
    // generation and after a failed one; without it a cold clone cannot even
    // typecheck.
    if (!await exists(outFile)) await writeIfChanged(outFile, placeholder());

    try {
      const { collection, dependencies } = await collect({ options: settings, resolved });

      // A key set short of the real one is worse than none: the types would
      // claim a key exists, or hide one that does, and the runtime would
      // disagree. On an error the previous artifact stands.
      if (report(collection, log)) {
        await writeIfChanged(outFile, emit(collection.entries, collection.referenceLocale, collection.skipped).contents);
      }

      return dependencies;
    } catch (cause) {
      log('error', `Could not read '${settings.config}'. [config-unreadable]`, cause);

      return [];
    }
  };

  return {
    name: NAME,

    configResolved(config) {
      resolved = config;
      outFile = absolute(config.root, settings.outFile);
    },

    async buildStart() {
      if (!settings.enabled || resolved.command !== 'build' || generated.has(resolved) || building.has(outFile)) return;

      generated.add(resolved);
      building.add(outFile);
      claimed = true;

      // Reported, never thrown. The artifact is types: a build that cannot be
      // typed still deploys, and the placeholder keeps the project compiling.
      // Making a deploy hinge on a loader that blinked would be the worse
      // trade, and a CI freshness gate is the right place for strictness.
      await generate((severity, message, cause) => {
        this.warn(cause === undefined ? message : `${message}\n${explain(cause)}`);
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

    async configureServer(server) {
      if (!settings.enabled) return;

      const log: Report = (severity, message, cause) => {
        server.config.logger[severity === 'error' ? 'error' : 'warn'](`[${NAME}] ${message}`);

        if (cause !== undefined) server.config.logger.error(explain(cause));
      };

      const root = posix(resolved.root);
      const generatedId = posix(outFile);

      // What a regeneration answers to: the config module and every catalogue
      // the loaders actually reached, the other locales' included. The
      // artifact itself is left out — it lands inside the tree the server
      // watches.
      const watched = new Set<string>();

      const remember = (dependencies: readonly string[]): void => {
        watched.clear();

        dependencies
          .filter((id) => !id.startsWith('\0') && id.startsWith(root) && id !== generatedId)
          .forEach((id) => watched.add(id));

        server.watcher.add([...watched]);
      };

      // Saving a whole editor session changes several files at once, and each
      // generation runs a Vite pipeline of its own. Chaining them is what keeps
      // the last write the last one to have been derived.
      let pending = generate(log).then(remember);

      server.watcher.on('change', (path) => {
        if (!watched.has(posix(path))) return;

        pending = pending.then(async () => remember(await generate(log)));
      });

      await pending;
    },
  };
};
