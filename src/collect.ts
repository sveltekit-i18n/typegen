import { access } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import type { Plugin, ResolvedConfig } from 'vite';

import { collectorSource } from './collector.js';
import type { Collection, Options } from './types.js';

const VIRTUAL = '\0virtual:sveltekit-i18n-typegen';

const CORE = 'virtual:sveltekit-i18n-typegen/core';
const CORE_ID = `\0${CORE}`;

const LIB = 'sveltekit-i18n';
const BASE = '@sveltekit-i18n/base';

// The package a specifier names, when it is one of the two a config builds its
// instance from.
const corePackage = (id: string): string | undefined => (
  [LIB, BASE].find((name) => id === name || id.startsWith(`${name}/`))
);

// A `runnerImport` environment loads dependencies raw, so the core's rune
// modules — which ship uncompiled, for the consumer's bundler — would reach the
// host runtime with `$state` undefined. `esm-env` is what `$app/environment`
// reads, and externalized it answers `undefined` rather than a boolean, which a
// config branching on `dev` reads as production by accident.
const NO_EXTERNAL = ['sveltekit-i18n', /^@sveltekit-i18n\//, 'esm-env'];

/**
 * Runs the collection under the build's own notion of the environment.
 *
 * `runnerImport` always resolves as `serve`, so a config branching on `dev`
 * would hand a production build the development key set — and `runnerImport`
 * rewrites `NODE_ENV` on the way through, which the app's own build then
 * inherits. Both are the same fix: state it, and put back whatever was there.
 */
const asEnvironment = async <T>(production: boolean, work: () => Promise<T>): Promise<T> => {
  const previous = process.env.NODE_ENV;

  process.env.NODE_ENV = production ? 'production' : 'development';

  try {
    return await work();
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
};

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

      // A config that imports the core directly and no `sveltekit-i18n` runs on
      // that copy; one that imports neither, a plain object, gets whichever the
      // app has, `sveltekit-i18n` first.
      const lib = importers.has(BASE) && !importers.has(LIB) ? null : await this.resolve(LIB, importers.get(LIB), { skipSelf: true });

      coreImporter = lib?.id ?? importers.get(BASE);

      const core = await this.resolve(BASE, coreImporter, { skipSelf: true });

      return [
        `export { I18n } from '${BASE}';`,
        // A namespace import, so a 3.0 core, which has no `resolveLoaders`,
        // still links.
        `export * as utils from '${BASE}/utils';`,
        `export const location = ${JSON.stringify(core?.id ?? null)};`,
      ].join('\n');
    },
  };
};

/**
 * The app's own plugins, built fresh.
 *
 * Reusing the resolved array instead is measurably unsafe: SvelteKit's plugins
 * share one closure, and re-running their `configResolved` inside a nested
 * environment overwrites the config the outer build later reads — the adapter
 * then never runs and the build still exits zero. Building a second, isolated
 * pipeline is the only arrangement that leaves the outer build's output
 * untouched.
 */
const appPlugins = async (): Promise<Plugin[]> => {
  try {
    const { sveltekit } = await import('@sveltejs/kit/vite');

    return await sveltekit();
  } catch {
    // Not a SvelteKit app, or Kit is not installed: the aliases carried below
    // are then the whole of what the config module needs.
    return [];
  }
};

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

  return `/${relative(root, path).split(sep).join('/')}`;
};

export type CollectInput = {
  options: Options.T & { configExport: string };
  resolved: ResolvedConfig;
};

/**
 * Evaluates the app's i18n config and its loaders, and reads back the keys.
 *
 * The work happens at the top level of a generated module rather than through
 * the returned exports: the runner is closed by the time `runnerImport`
 * resolves, and a loader called after that point throws.
 */
export const collect = async ({ options, resolved }: CollectInput): Promise<{ collection: Collection; dependencies: string[] }> => {
  const { runnerImport } = await import('vite');

  const source = collectorSource({
    config: await configId(resolved.root, options.config),
    configExport: options.configExport,
    derive: new URL('./derive.js', import.meta.url).href,
    core: CORE,
    extractParams: options.extractParams,
    referenceLocale: options.referenceLocale,
    checkLocales: options.checkLocales,
  });

  const { module, dependencies } = await asEnvironment(resolved.command === 'build', async () => (
    runnerImport<{ collection: Collection }>(VIRTUAL, {
      root: resolved.root,
      plugins: [serve(source), ...await appPlugins()],
      resolve: {
        alias: resolved.resolve.alias,
        noExternal: NO_EXTERNAL,
      },
      logLevel: 'silent',
    })
  ));

  return { collection: module.collection, dependencies };
};
