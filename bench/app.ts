import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { LIB } from './collect.ts';
import { LOCALES, table, type Shape } from './data.ts';

/**
 * The app a generation runs in: a SvelteKit app whose `vite.config.js` loads
 * the plugin of the tree measured. Its catalogues and its i18n config are
 * written per case, under `src/cases`. Its `package.json` declares
 * `sveltekit-i18n`, as an app does: the Svelte plugin compiles the core's rune
 * modules for the server only for a dependency the app declares.
 */
export const APP = resolve(dirname(fileURLToPath(import.meta.url)), 'app');

process.env.BENCH_PLUGIN = pathToFileURL(join(LIB, 'index.js')).href;

// SvelteKit reads `svelte.config.js` and the app template off the working
// directory rather than off Vite's root, so the app is entered as its own
// scripts enter it.
process.chdir(APP);

/** How often the app's `vite.config.js` was evaluated in this process: once per config a generation resolves. */
export const configLoads = () => (globalThis as { benchConfigLoads?: number }).benchConfigLoads ?? 0;

export type Case = {
  /** The catalogues of the first namespace, one per locale, the reference's first. */
  catalogues: string[];
  /** The artifact, relative to the app. */
  outFile: string;
};

/**
 * Writes `keys` keys laid out by `shape` as the app's catalogues, a JSON file
 * per namespace and locale, and an i18n config with a loader per file that
 * imports it by a template literal, as an app's loaders do; then sets the
 * plugin's options for it.
 */
export const writeCase = (keys: number, shape: Exclude<Shape, 'flat'>): Case => {
  const name = `${shape}-${keys}`;
  const dir = join(APP, 'src/cases', name);
  const data = table(keys, shape);

  rmSync(dir, { recursive: true, force: true });

  for (const locale of LOCALES) {
    mkdirSync(join(dir, locale), { recursive: true });

    for (const namespace of Object.keys(data)) writeFileSync(join(dir, locale, `${namespace}.json`), JSON.stringify(data[namespace]));
  }

  writeFileSync(join(dir, 'i18n.js'), [
    `const namespaces = ${JSON.stringify(Object.keys(data))};`,
    '',
    'export const config = {',
    '  initLocale: \'en\',',
    `  loaders: ${JSON.stringify(LOCALES)}.flatMap((locale) => namespaces.map((namespace) => ({`,
    '    locale,',
    '    namespace,',
    '    loader: async () => (await import(`./${locale}/${namespace}.json`)).default,',
    '  }))),',
    '};',
    '',
  ].join('\n'));

  const outFile = `src/cases/${name}/schema.d.ts`;

  process.env.BENCH_OPTIONS = JSON.stringify({ config: `src/cases/${name}/i18n.js`, outFile, extractParams: { from: 'sveltekit-i18n' } });

  return { catalogues: LOCALES.map((locale) => join(dir, locale, `${Object.keys(data)[0]}.json`)), outFile };
};
