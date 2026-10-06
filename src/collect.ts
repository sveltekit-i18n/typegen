import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { DevEnvironment, Plugin, ResolvedConfig } from 'vite';

import { collectorSource } from './collector.js';
import type { Collection, Options } from './types.js';

const VIRTUAL = '\0virtual:sveltekit-i18n-typegen';

const CLOSE_TIMEOUT = 5_000;

const CORE = 'virtual:sveltekit-i18n-typegen/core';
const CORE_ID = `\0${CORE}`;

const LIB = 'sveltekit-i18n';
const BASE = '@sveltekit-i18n/base';

// The package a specifier names, when it is one of the two a config builds its
// instance from.
const corePackage = (id: string): string | undefined => (
  [LIB, BASE].find((name) => id === name || id.startsWith(`${name}/`))
);

/**
 * Serves the collector, and the core it builds its probe from.
 *
 * The probe has to come from the copy of the core the config itself runs on:
 * the one `sveltekit-i18n` depends on when the config imports that (which the
 * app root need not resolve at all, as under pnpm), the one it imports
 * otherwise. The config's imports are resolved before the collector asks for
 * the core, so they are watched on the way through.
 */
const serve = (source: string): Plugin => {
  const importers = new Map<string, string>();
  let coreImporter: string | undefined;

  return {
    name: 'sveltekit-i18n-typegen:collector',
    enforce: 'pre',

    async resolveId(id, importer, options) {
      if (id === VIRTUAL) return VIRTUAL;
      if (id === CORE) return CORE_ID;

      // The core module names the core by bare specifier, resolved from the
      // package the config reached it through.
      if (importer === CORE_ID) return this.resolve(id, coreImporter, { ...options, skipSelf: true });

      const name = corePackage(id);

      if (name && importer && importer !== VIRTUAL && !importers.has(name)) importers.set(name, importer);

      return undefined;
    },

    async load(id) {
      if (id === VIRTUAL) return source;
      if (id !== CORE_ID) return undefined;

      const { depsOptimizer } = this.environment as { depsOptimizer?: DevEnvironment['depsOptimizer'] };

      // A pre-bundled package is resolved to its bundle in the cache, which
      // neither resolves the core as the package does nor names where it lies.
      const installed = (resolvedId: string | undefined): string | undefined => {
        const file = resolvedId?.replace(/[?#].*$/, '');
        const optimized = Object.values(depsOptimizer?.metadata.optimized ?? {}).find((dependency) => dependency.file === file);

        return optimized?.src ?? file;
      };

      // A config that imports the core directly and no `sveltekit-i18n` runs on
      // that copy; one that imports neither, a plain object, gets whichever the
      // app has, `sveltekit-i18n` first.
      const lib = importers.has(BASE) && !importers.has(LIB) ? null : await this.resolve(LIB, importers.get(LIB), { skipSelf: true });

      coreImporter = installed(lib?.id ?? importers.get(BASE));

      const core = await this.resolve(BASE, coreImporter, { skipSelf: true });

      return [
        `export { I18n } from '${BASE}';`,
        // A namespace import, so a 3.0 core, which has no `resolveLoaders`,
        // still links.
        `export * as utils from '${BASE}/utils';`,
        `export const location = ${JSON.stringify(installed(core?.id) ?? null)};`,
      ].join('\n');
    },
  };
};

const KIT = 'vite-plugin-sveltekit-setup';

const hasKit = (plugins: readonly Plugin[]): boolean => plugins.some(({ name }) => name === KIT);

/**
 * A fresh `sveltekit()`, for a nested config that lacks the Kit the outer one
 * has — a programmatic build without a config file, or with Kit passed inline.
 *
 * Never the outer build's instances: SvelteKit's plugins share one closure,
 * and re-running their `configResolved` for the nested config overwrites the
 * config the outer build later reads — the adapter then never runs and the
 * build still exits zero.
 */
const freshKit = async (): Promise<Plugin[]> => {
  const { sveltekit } = await import('@sveltejs/kit/vite');

  return sveltekit();
};

const toPosix = (path: string): string => path.split(sep).join('/');

/**
 * The id the collector imports the config by.
 *
 * A path is spelled relative to the Vite root, which is not a module specifier
 * — it has to become a root-relative id, with the separators Vite speaks. What
 * is not a path is handed through untouched, so an alias like `$lib/i18n.js`
 * reaches the app's own resolvers.
 */
const configId = async (root: string, config: string): Promise<string> => {
  const path = isAbsolute(config) ? config : resolve(root, config);
  const reachable = await access(path).then(() => true, () => false);

  if (!reachable) return config;

  return `/${toPosix(relative(root, path))}`;
};

export type CollectInput = {
  options: Options.T & { configExport: string };
  resolved: ResolvedConfig;
};

// A cache of the collection's own, so the app's pre-bundled dependencies are
// never rewritten under a dev server it runs meanwhile. Where `node_modules`
// cannot be written, a throwaway one, cold every time.
const withCacheDir = async <T>(preferred: string, work: (cacheDir: string) => Promise<T>): Promise<T> => {
  try {
    await mkdir(preferred, { recursive: true });
    // `mkdir` succeeds on a directory that exists read-only.
    await access(preferred, constants.W_OK);
  } catch {
    const temporary = await mkdtemp(join(tmpdir(), 'sveltekit-i18n-typegen-'));

    try {
      return await work(temporary);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  return work(preferred);
};

/**
 * Evaluates the app's i18n config and its loaders, and reads back the keys.
 *
 * They run in the app's own server environment, resolved from its config for
 * `serve` — the environment its dev server renders with. Its resolution, its
 * pre-bundling and its plugins are then the app's by construction: the config
 * reaches its dependencies as the app's own pages do, the core's rune modules
 * compiled wherever they come from. No server is started — no watcher, no
 * `configureServer` — so nothing of it outlives the collection.
 *
 * The work happens at the top level of a generated module rather than through
 * the returned exports: a loader called once the environment is closed throws.
 */
/**
 * What the collection reached of the app. `dependencies` is what the loaders
 * evaluated; `reached` is every module that loaded, one whose transform failed
 * included, which a run that failed has to answer to: its next change is what
 * fixes the run.
 */
export type Collected = { collection: Collection; dependencies: string[]; reached: string[] } | { cause: unknown; reached: string[] };

export const collect = async ({ options, resolved }: CollectInput): Promise<Collected> => {
  const { createLogger, createRunnableDevEnvironment, resolveConfig } = await import('vite');

  const source = collectorSource({
    config: await configId(resolved.root, options.config),
    configExport: options.configExport,
    derive: new URL('./derive.js', import.meta.url).href,
    core: CORE,
    extractParams: options.extractParams,
    referenceLocale: options.referenceLocale,
    checkLocales: options.checkLocales,
  });

  // Everything the build was handed inline — a `--mode`, a programmatic
  // `resolve` — but its plugin instances, which the nested config builds anew.
  const { plugins: _, ...inline } = resolved.inlineConfig;
  const configFile = resolved.configFile ?? false;
  const kit = hasKit(resolved.plugins);

  const nested = (cacheDir: string, plugins: Plugin[]) => resolveConfig({
    ...inline,
    root: resolved.root,
    configFile,
    mode: resolved.mode,
    cacheDir,
    // A logger of its own rather than a log level: the Svelte plugin sets the
    // level of a logger it shares with the app's, and the build's own warnings
    // would go quiet.
    customLogger: createLogger('silent'),
    plugins: [serve(source), ...plugins],
  }, 'serve');

  return withCacheDir(join(resolved.cacheDir, 'typegen'), async (cacheDir) => {
    // Without a config file, what the nested config holds is only what is
    // inline, so the outer Kit is known to be missing before anything resolves.
    let config = await nested(cacheDir, kit && !configFile ? await freshKit() : []);

    if (kit && !hasKit(config.plugins)) config = await nested(cacheDir, await freshKit());

    const environment = createRunnableDevEnvironment('ssr', config, { hot: false, runnerOptions: { hmr: { logger: false } } });

    // The pre-bundled and the installed dependencies change only with an
    // install.
    const ofApp = (files: (string | null | undefined)[]): string[] => files
      .filter((file): file is string => !!file && !toPosix(file).startsWith(toPosix(cacheDir)) && !toPosix(file).split('/').includes('node_modules'));

    // A module enters the graph once it has loaded, before its transform can
    // fail.
    const reached = (): string[] => ofApp([...environment.moduleGraph.idToModuleMap.values()].map(({ file }) => file));

    try {
      await environment.init();
      // What a dev server's `listen()` does; a CommonJS dependency the app
      // pre-bundles runs only once it has.
      await environment.depsOptimizer?.init();

      const module = await environment.runner.import<{ collection: Collection }>(VIRTUAL);

      // What the loaders evaluated: the graph also holds what a reached module
      // could import and never did, every file a glob of a dynamic import
      // matches among them.
      const evaluated = [...environment.runner.evaluatedModules.urlToIdModuleMap.values()]
        .filter(({ meta, exports }) => meta && !('externalize' in meta) && exports !== module);

      return { collection: module.collection, dependencies: ofApp(evaluated.map(({ file }) => file)), reached: reached() };
    } catch (cause) {
      return { cause, reached: reached() };
    } finally {
      // Closing waits for every request still open, and a loader past its
      // deadline can hold one forever. A failed start leaves the environment
      // unable to close, and its own error is the one to report.
      await Promise.race([
        environment.close().catch(() => {}),
        new Promise((closed) => { setTimeout(closed, CLOSE_TIMEOUT).unref(); }),
      ]);
      // Vite's native resolver keeps a closed environment alive, and with it
      // the code it transformed, which every generation of a dev server would
      // otherwise add to.
      environment.moduleGraph.invalidateAll();
    }
  });
};
