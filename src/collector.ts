import type { Options } from './types.js';

// `undefined` has no JSON form, which is exactly the spelling an omitted
// option needs in the generated source.
const literal = (value: unknown): string => JSON.stringify(value) ?? 'undefined';

export type CollectorInput = {
  /** The app's config module, as an id the app's own graph resolves. */
  config: string;
  configExport: string;
  /** Where this package's own `derive` sits on disk, as a `file:` URL. */
  derive: string;
  /** The id the core the config runs on is served under. */
  core: string;
  extractParams?: Options.ExtractParams;
  referenceLocale?: string;
  checkLocales?: boolean;
};

const EXTRACTOR_NAME = 'extractParamsFactory';

/**
 * The extractor, built the way the app builds its parser.
 *
 * It is imported dynamically so that a specifier that does not resolve, or a
 * module that does not carry the export, degrades to keys-only rather than
 * taking the whole collection down with it.
 */
const extractor = (options?: Options.ExtractParams): string[] => {
  if (!options) return ['const extract = null;', 'const extractorFailure = null;'];

  const { from, name = EXTRACTOR_NAME } = options;

  return [
    'let extract = null;',
    'let extractorFailure = null;',
    '',
    'try {',
    `  const extractorModule = await import(${literal(from)});`,
    `  const factory = extractorModule[${literal(name)}];`,
    '',
    "  if (typeof factory !== 'function') {",
    `    extractorFailure = { message: ${literal(`'${from}' has no '${name}' export.`)} };`,
    '  } else {',
    `    extract = factory(${literal(options.options)});`,
    '  }',
    '} catch (cause) {',
    `  extractorFailure = { message: ${literal(`'${from}' could not be read.`)}, cause };`,
    '}',
  ];
};

/**
 * The module the collection runs as.
 *
 * The environment it runs in is closed the moment the import returns, so a
 * loader invoked afterwards throws. Everything therefore happens at the top level,
 * under `await`, and only the finished result is read off the exports.
 *
 * The core is the copy the config runs on, and the extractor is imported by
 * bare specifier, so the APP's copies answer — the key set has to be the one
 * the app's own versions produce.
 * `derive` is imported by `file:` URL instead: it is this package's code, it
 * carries no runes and no bare imports of its own, so the runner hands it
 * straight to the host runtime.
 */
export const collectorSource = ({ config, configExport, derive, core, extractParams, referenceLocale, checkLocales }: CollectorInput): string => [
  `import * as configModule from ${literal(config)};`,
  `import { derive } from ${literal(derive)};`,
  '',
  // Imported once the config has evaluated, so the core it names is the one
  // the config's own imports reached.
  `const { I18n, utils: coreUtils, location: coreLocation } = await import(${literal(core)});`,
  ...extractor(extractParams),
  '',
  `const config = configModule[${literal(configExport)}];`,
  '',
  // Only `preprocess` and `log` reach the probe: a parser would render
  // messages this never renders, and a loader trigger would start a load this
  // drives by hand. `log` sets the core's logger, which reports what reading
  // the loaders finds, as the app's own config would. The probe sanitizes no
  // locale: `derive` hands it every table under the locale the core files it
  // under, and a second pass is not a no-op for every `sanitizeLocales`.
  'const probe = new I18n({ preprocess: config?.preprocess, sanitizeLocales: false, log: config?.log });',
  '',
  'export const collection = await derive({',
  '  probe,',
  '  config,',
  `  configExport: ${literal(configExport)},`,
  '  configExports: Object.keys(configModule),',
  '  sanitizeLocales: coreUtils.sanitizeLocales,',
  '  resolveLoaders: coreUtils.resolveLoaders,',
  '  coreLocation,',
  `  checkLocales: ${literal(checkLocales)},`,
  '  extract,',
  '  extractorFailure,',
  `  referenceLocale: ${literal(referenceLocale)},`,
  '});',
  '',
].join('\n');
