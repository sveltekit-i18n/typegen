import type { Parser } from '@sveltekit-i18n/base';

import type { Collection, Diagnostic, Entry, Skipped } from './types.js';

type LoaderProps = { locale: string; namespace: unknown; route: string; params: Record<string, string> };

type Descriptor = { namespace?: unknown; key?: unknown; locale?: string; routes?: unknown; loader?: (props: LoaderProps) => unknown };

/** One locale and one namespace, the shape the core's `resolveLoaders` hands back. */
type Loader = { namespace: unknown; locale: string; routes?: unknown; loader?: Descriptor['loader'] };

type Config = {
  loaders?: readonly unknown[];
  translations?: Record<string, unknown>;
  initLocale?: string;
  fallbackLocale?: string;
  preprocess?: unknown;
  log?: unknown;
  sanitizeLocales?: boolean | ((locale: string) => string);
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

// The extractor is the app's parser, so its output is read at this boundary:
// `emit` takes a name and a condition as the contract spells them.
const isParamSpec = (spec: unknown): spec is Parser.ParamSpec => (
  isObject(spec)
  && typeof spec.name === 'string'
  && (spec.when === undefined || (Array.isArray(spec.when) && spec.when.every((one) => (
    isObject(one) && typeof one.param === 'string' && typeof one.branch === 'string'
  ))))
);

export type ResolveLoaders = (loaders: readonly any[] | undefined, sanitizeLocales?: any) => readonly Loader[];

export type Probe = {
  addTranslations: (translations: any) => void;
  translations: Record<string, Record<string, unknown>>;
};

export type DeriveInput = {
  /**
   * Built by the caller from the APP's own copy of the core, carrying the
   * config's `preprocess` — the key set has to be the one the app's version
   * produces, not this package's — and sanitizing no locale.
   */
  probe: Probe;
  /** What the config module carried, which may be nothing at all. */
  config?: Config;
  /** The name it was looked for under, so a diagnostic can name it. */
  configExport?: string;
  /** What the module does export, so a near miss can be named too. */
  configExports?: readonly string[];
  /** The core's own `sanitizeLocales`, from the app's copy of it. */
  sanitizeLocales: (...locales: unknown[]) => string[];
  /**
   * The core's own `resolveLoaders`, from the app's copy of it. A 3.0 core has
   * none, and its loaders are read here instead.
   */
  resolveLoaders?: ResolveLoaders;
  /**
   * The core's own `matchLocale`, from the app's copy of it, which settles a
   * stated locale on one the config serves. A 3.0 core has none.
   */
  matchLocale?: (requested: string, available: readonly string[]) => string | undefined;
  /** Where the core the config runs on was found, for a diagnostic to name. */
  coreLocation?: string | null;
  /** Whether the other locales are loaded and compared with the reference. Defaults to `true`. */
  checkLocales?: boolean;
  extract: Parser.ExtractParams | null;
  /** Why there is no extractor although one was asked for. */
  extractorFailure?: { message: string; cause?: unknown } | null;
  referenceLocale?: string;
  /** How long one loader may take. Defaults to thirty seconds. */
  deadline?: number;
};

/**
 * The normalization `config.sanitizeLocales` asks for, mirroring the core's own
 * three branches: a custom transform, no normalization at all, or the default.
 * A custom one is consumer code, so a throw or an empty answer degrades to the
 * locale as authored rather than losing it.
 */
const sanitizerFor = ({ sanitizeLocales: custom }: Config, fallback: (...locales: unknown[]) => string[]) => (
  (locale: string): string => {
    if (typeof custom === 'function') {
      try {
        return `${custom(locale) || locale}`;
      } catch {
        return locale;
      }
    }

    // The core's default parameter covers only `undefined`; any other falsy
    // value turns normalization off, in a JavaScript config too.
    if (custom !== undefined && !custom) return locale;

    const [sanitized = locale] = fallback(locale);

    return sanitized;
  }
);

const isPlain = (value: unknown): boolean => !!value && typeof value === 'object' && !Array.isArray(value);

// Mirrors the merge `serialize` performs when two loaders share a namespace:
// plain objects merge branch by branch, anything else is a leaf and the
// incoming value wins. Reproduced rather than imported because the core keeps
// it internal, and a batch assembled any other way would run `preprocess` a
// different number of times than the app runs it.
const merge = (target: unknown, source: unknown): unknown => {
  if (!isPlain(target) || !isPlain(source)) return source;

  // Written in place, as rebuilding per key is quadratic, into a null-prototype
  // copy spread once on the way out, so a '__proto__' key stays an own key.
  const output: Record<string, unknown> = Object.assign(Object.create(null), target);

  Object.keys(source as object).forEach((key) => {
    output[key] = Object.hasOwn(output, key) ? merge(output[key], (source as any)[key]) : (source as any)[key];
  });

  return { ...output };
};

// What a 3.0 core loads, which has no `resolveLoaders` to ask: one locale and
// the namespace under `key`, its only name there — a descriptor without one
// lands under 'undefined'. Loader properties are consumer code and an accessor
// may throw, so each descriptor is materialized on its own.
const readLoaders = (input: readonly unknown[] = [], sanitize: (locale: string) => string): Loader[] => (
  input.flatMap((descriptor) => {
    try {
      const { key, locale, routes, loader } = descriptor as Descriptor;

      return locale ? [{ namespace: key, locale: sanitize(locale), routes, loader }] : [];
    } catch {
      return [];
    }
  })
);

// A descriptor only a 3.1 core reads: a 3.0 one files a `namespace` under
// 'undefined' and an array of locales under no locale it serves, so the types
// would name keys the app does not have.
const spelledFor31 = (descriptor: unknown): boolean => {
  try {
    const { namespace, locale } = descriptor as Descriptor & { locale?: unknown };

    return namespace !== undefined || Array.isArray(locale);
  } catch {
    return false;
  }
};

/**
 * The route a loader is called with.
 *
 * The empty string is not a route any app visits: a loader that reads it can
 * throw, and one that derives keys from it derives the wrong ones. Its own
 * first route is the closest thing to where the app would have run it, and a
 * pattern has no string to offer, so the root stands in.
 */
const routeFor = ({ routes }: Loader): string => {
  const [first] = Array.isArray(routes) ? routes as unknown[] : [];

  return typeof first === 'string' ? first : '/';
};

// Whether a route can yield params: a pattern with a named group, as the core
// reads it — its own check is not published.
const namesGroups = (input: unknown): boolean => {
  if (!(input instanceof RegExp)) return false;

  try {
    const groups = new RegExp(`(?:${input.source})|`, input.flags.replace(/[gy]/g, '')).exec('')?.groups;

    return !!groups && Object.keys(groups).length > 0;
  } catch {
    return false;
  }
};

const capturesParams = ({ routes }: Loader): boolean => Array.isArray(routes) && routes.some(namesGroups);

// What SvelteKit throws when a remote function runs outside a request.
const REQUEST_STORE = 'Could not get the request store.';

const needsRequest = (cause: unknown): boolean => {
  try {
    const { message } = cause as { message?: unknown };

    return typeof message === 'string' && message.startsWith(REQUEST_STORE);
  } catch {
    return false;
  }
};

/**
 * How a namespace whose loader cannot run here is typed, or `undefined` when
 * its failure has to fail the generation.
 *
 * Only a throw that shows the missing context qualifies: a remote function
 * outside a request, or a loader whose routes capture params it was not given.
 * Anything else — a network that blinked, a deadline — would otherwise replace
 * a narrow schema with an open one. The key shape is known for the core's own
 * strategies only: a custom `preprocess` could file the data anywhere.
 */
const skipOf = (descriptor: Loader, cause: unknown, preprocess: unknown, params: boolean): Skipped | undefined => {
  const { namespace } = descriptor;

  if (typeof namespace !== 'string') return undefined;
  if (!needsRequest(cause) && !(params && capturesParams(descriptor))) return undefined;
  if (preprocess === 'none') return { namespace, whole: true };
  // Preprocessed, an empty namespace files its keys unprefixed, so there is no
  // prefix to open.
  if (!namespace) return undefined;
  if (preprocess === undefined || preprocess === 'full' || preprocess === 'preserveArrays') return { namespace, whole: false };

  return undefined;
};

const under = ({ namespace, whole }: Skipped) => (key: string): boolean => key === namespace || (!whole && key.startsWith(`${namespace}.`));

const DEADLINE = 30_000;

/**
 * A loader is consumer code reaching the network, and the collection runs under
 * a top-level await — one that never settles hangs the build with nothing to
 * read and nothing to report. A deadline turns that into an ordinary
 * diagnostic.
 */
const withDeadline = async <T>(work: Promise<T>, after: number): Promise<T> => {
  let settled = (): void => {};

  const deadline = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`It did not settle within ${after}ms.`)), after);

    settled = () => clearTimeout(timer);
  });

  try {
    return await Promise.race([work, deadline]);
  } finally {
    settled();
  }
};

/**
 * The locale whose catalogue defines the key set. A config's own starting point
 * is the best guess at the catalogue its author keeps complete. `/kit` reads it
 * as a candidate it matches to a served locale (`en-US` serves `en`), and so
 * does this; a `referenceLocale` asked for is only sanitized. `unserved` names
 * the stated locale matched when none is served as stated, which an instance
 * built without `/kit` does not match.
 */
const pickReference = (
  config: Config,
  loaders: readonly Loader[],
  sanitize: (locale: string) => string,
  requested?: string,
  match?: DeriveInput['matchLocale'],
): { reference?: string; unserved?: string } => {
  if (requested) return { reference: sanitize(requested) };

  const stated = [config.initLocale, config.fallbackLocale].filter((locale): locale is string => !!locale).map(sanitize);

  if (stated.length) {
    const served = [...new Set([...loaders.map(({ locale }) => locale), ...Object.keys(config.translations ?? {}).map(sanitize)])];
    const matched = stated.map((locale) => [locale, served.includes(locale) ? locale : match?.(locale, served)] as const).find(([, locale]) => locale !== undefined);

    if (!matched) return { reference: stated[0] };

    const [candidate, reference] = matched;

    return stated.some((locale) => served.includes(locale)) ? { reference } : { reference, unserved: candidate };
  }

  const fromTranslations = Object.keys(config.translations ?? {})[0];

  if (fromTranslations) return { reference: sanitize(fromTranslations) };

  return { reference: loaders[0]?.locale };
};

// Files each seeded locale under its sanitized name, merging the namespaces of
// two that meet there, as the core files a config's static table.
const sanitizeKeys = (translations: Record<string, unknown>, sanitize: (locale: string) => string): Record<string, unknown> => (
  Object.keys(translations).reduce<Record<string, unknown>>((acc, locale) => {
    const sanitized = sanitize(locale);

    return { ...acc, [sanitized]: { ...acc[sanitized] as object, ...translations[locale] as object } };
  }, {})
);

// A namespace may be a Symbol, which a template literal refuses to interpolate.
const loaderName = ({ locale, namespace }: Loader): string => `'${locale}' > '${String(namespace)}'`;

const LISTED = 10;

const listKeys = (keys: readonly string[]): string => {
  const named = keys.slice(0, LISTED).map((key) => `'${key}'`).join(', ');

  return keys.length > LISTED ? `${named} and ${keys.length - LISTED} more` : named;
};

const plural = (count: number): string => `${count} ${count === 1 ? 'key' : 'keys'}`;

/**
 * Runs the config's loaders and reads back the keys the core would hold.
 *
 * Route scoping is bypassed deliberately: a route-scoped loader contributes
 * keys the app reaches on SOME route, and the schema has to describe all of
 * them. A loader that throws is reported rather than skipped — the core
 * swallows one to keep a page rendering, but a key set silently short of the
 * real one would make the types lie.
 *
 * The other locales' loaders run alongside the reference's, so the key sets
 * can be compared. What they find is only reported: the schema follows the
 * reference alone.
 */
export const derive = async ({
  probe,
  config,
  configExport = 'config',
  configExports,
  sanitizeLocales,
  resolveLoaders,
  matchLocale,
  coreLocation,
  checkLocales = true,
  extract,
  extractorFailure,
  referenceLocale,
  deadline = DEADLINE,
}: DeriveInput): Promise<Collection> => {
  if (!config || typeof config !== 'object') {
    return {
      entries: [],
      referenceLocale: referenceLocale ?? '',
      diagnostics: [{
        code: 'config-export-missing',
        message: `The config module exports no '${configExport}'.${configExports?.length ? ` It exports ${configExports.map((name) => `'${name}'`).join(', ')}.` : ''}`,
      }],
    };
  }

  // The extractor degrades to keys-only rather than failing the collection: a
  // payload nobody checks costs less than a key set nobody has.
  const missingExtractor: Diagnostic.T[] = extractorFailure
    ? [{ code: 'extractor-unreadable', message: `${extractorFailure.message} Payloads stay unchecked.`, cause: extractorFailure.cause }]
    : [];

  const tooNew = resolveLoaders ? 0 : (config.loaders ?? []).filter(spelledFor31).length;

  if (tooNew) {
    return {
      entries: [],
      referenceLocale: referenceLocale ?? '',
      diagnostics: [...missingExtractor, {
        code: 'core-too-old',
        message: `${tooNew === 1 ? 'A loader names' : `${tooNew} loaders name`} a \`namespace\` or an array of locales, which the core${coreLocation ? ` at ${coreLocation}` : ''} does not read: it is 3.0, and the app runs on it. Install sveltekit-i18n or @sveltekit-i18n/base 3.1.`,
      }],
    };
  }

  const sanitize = sanitizerFor(config, sanitizeLocales);
  const loaders = resolveLoaders ? resolveLoaders(config.loaders, config.sanitizeLocales) : readLoaders(config.loaders, sanitize);
  const { reference, unserved } = pickReference(config, loaders, sanitize, referenceLocale, matchLocale);

  if (!reference) {
    return {
      entries: [],
      referenceLocale: referenceLocale ?? '',
      diagnostics: [...missingExtractor, { code: 'reference-locale-missing', message: 'The config names no locale to derive keys from.' }],
    };
  }

  // The core's constructor applies a config's static table in one call of its
  // own, before any load, under the locales sanitized once.
  if (config.translations) probe.addTranslations(sanitizeKeys(config.translations, sanitize));

  const callable = loaders.filter(({ loader }) => typeof loader === 'function');

  // A locale only seeded is not compared: a seed is often the same table in
  // every locale (the names of the languages), not a catalogue of its own.
  const locales = [reference, ...(checkLocales ? callable.map(({ locale }) => locale).filter((locale) => locale !== reference) : [])]
    .filter((locale, index, all) => all.indexOf(locale) === index);

  type Loaded = { descriptor: Loader; data?: unknown; failure?: { cause: unknown; skip?: Skipped } };

  // Every locale at once, so the whole collection waits one deadline at most.
  const loaded = await Promise.all(callable.filter(({ locale }) => locales.includes(locale)).map(async (descriptor): Promise<Loaded> => {
    const { locale, namespace } = descriptor;

    try {
      return { descriptor, data: await withDeadline(Promise.resolve(descriptor.loader!({ locale, namespace, route: routeFor(descriptor), params: {} })), deadline) };
    } catch (cause) {
      // Params come from a 3.1 core only: a 3.0 one never hands a loader any.
      return { descriptor, failure: { cause, skip: skipOf(descriptor, cause, config.preprocess, !!resolveLoaders) } };
    }
  }));

  const failedIn = (locale: string) => loaded.filter(({ descriptor, failure }) => failure && !failure.skip && descriptor.locale === locale);

  const failures = failedIn(reference).map(({ descriptor, failure }): Diagnostic.T => ({
    code: 'loader-threw',
    message: `The ${loaderName(descriptor)} loader threw, so its keys are missing.`,
    cause: failure!.cause,
  }));

  // One warning per namespace, in whichever locales it was skipped.
  const skippedLoads = loaded.filter(({ failure }) => failure?.skip);
  const skippedNames = skippedLoads.map(({ failure }) => failure!.skip!.namespace).filter((name, index, all) => all.indexOf(name) === index);
  const skipped = skippedNames.map((name) => skippedLoads.find(({ failure }) => failure!.skip!.namespace === name)!.failure!.skip!);
  const referenceSkipped = skipped.filter(({ namespace }) => skippedLoads.some(({ descriptor, failure }) => descriptor.locale === reference && failure!.skip!.namespace === namespace));

  const skips = skipped.map((skip): Diagnostic.T => {
    const of = skippedLoads.filter(({ failure }) => failure!.skip!.namespace === skip.namespace);
    const locales = [...new Set(of.map(({ descriptor }) => descriptor.locale))].map((locale) => `'${locale}'`).join(', ');

    return {
      code: 'loader-skipped',
      message: `The '${skip.namespace}' loader cannot run outside the app (${locales}), so ${referenceSkipped.includes(skip)
        ? `any key under '${skip.namespace}' is accepted and its payload is not checked`
        : `'${skip.namespace}' was not compared`}.`,
      cause: of[0].failure!.cause,
    };
  });

  const isSkipped = (key: string): boolean => skipped.some((skip) => under(skip)(key));

  // One batch per locale, one `addTranslations` each, as a single visit to
  // every route would have produced. `preprocess` runs once per locale per
  // call, so a custom one that only looks at the leaf it is given sees exactly
  // what the app gives it; one whose output depends on the siblings in the
  // batch is grouping dependent, and no grouping reproduces every route an app
  // can take. A batch is written in place, as rebuilding it per loader is
  // quadratic, into a null-prototype object spread once on the way out, so a
  // namespace named '__proto__' stays an own key.
  const batchOf = (locale: string): Record<string, unknown> => ({
    ...loaded.reduce<Record<string, unknown>>((acc, { descriptor, data }) => {
      if (!data || descriptor.locale !== locale) return acc;

      // Keyed as the core keys it, which spells an absent 3.0 `key` 'undefined'.
      const name = descriptor.namespace as string;

      acc[name] = Object.hasOwn(acc, name) ? merge(acc[name], data) : data;

      return acc;
    }, Object.create(null)),
  });

  const apply = (locale: string): void => {
    const batch = batchOf(locale);

    if (Object.keys(batch).length) probe.addTranslations({ [locale]: batch });
  };

  apply(reference);

  // Another locale's catalogue is only compared: one the app's `preprocess`
  // cannot take costs that comparison, not the schema.
  const unapplied = new Map<string, unknown>();

  locales.filter((locale) => locale !== reference).forEach((locale) => {
    try {
      apply(locale);
    } catch (cause) {
      unapplied.set(locale, cause);
    }
  });

  const table = probe.translations[reference] ?? {};

  // One message the extractor cannot read costs its own payload, not the whole
  // artifact: the key still narrows, its payload stays unchecked.
  const readOne = (key: string): { entry: Entry; thrown?: Diagnostic.T } => {
    const value = table[key];

    if (!extract) return { entry: { key, value, params: null } };

    const unread = (message: string, cause?: unknown) => ({
      entry: { key, value, params: null },
      thrown: { code: 'extractor-threw' as const, message, cause },
    });

    try {
      const params: unknown[] = [...extract(value as any, { key, locale: reference })];

      if (!params.every(isParamSpec)) return unread(`The extractor returned no parameter list for '${key}'.`);

      return { entry: { key, value, params } };
    } catch (cause) {
      return unread(`The extractor threw on '${key}'.`, cause);
    }
  };

  const read = Object.keys(table).map(readOne);
  const entries = read.map(({ entry }) => entry);
  const thrown = read.flatMap(({ thrown: one }) => (one ? [one] : []));

  // A reference short of its own keys would report every other locale's as
  // extra.
  const comparable = !failures.length && (entries.length > 0 || referenceSkipped.length > 0);
  // A namespace skipped in any locale is left out on both sides.
  const referenceKeys = new Set(Object.keys(table).filter((key) => !isSkipped(key)));
  const fallback = config.fallbackLocale ? sanitize(config.fallbackLocale) : undefined;

  const compare = (locale: string): Diagnostic.T[] => {
    if (unapplied.has(locale)) {
      return [{
        code: 'locale-unchecked',
        message: `The '${locale}' catalogue could not be applied, so '${locale}' was not compared with '${reference}'.`,
        cause: unapplied.get(locale),
      }];
    }

    const [failed] = failedIn(locale);

    if (failed) {
      return [{
        code: 'locale-unchecked',
        message: `The ${loaderName(failed.descriptor)} loader threw, so '${locale}' was not compared with '${reference}'.`,
        cause: failed.failure!.cause,
      }];
    }

    const keys = Object.keys(probe.translations[locale] ?? {}).filter((key) => !isSkipped(key));
    const own = new Set(keys);
    const missing = [...referenceKeys].filter((key) => !own.has(key)).sort();
    const extra = keys.filter((key) => !referenceKeys.has(key)).sort();
    const fallbackTable = fallback && fallback !== locale ? probe.translations[fallback] ?? {} : {};
    const covered = missing.filter((key) => Object.hasOwn(fallbackTable, key)).length;
    const rendered = covered === 0 ? '' : ` ${covered === missing.length ? 'They' : `${covered} of them`} render from '${fallback}'.`;

    return [
      ...(missing.length ? [{
        code: 'key-missing' as const,
        message: `'${locale}' lacks ${plural(missing.length)} the reference '${reference}' has: ${listKeys(missing)}.${rendered}`,
      }] : []),
      ...(extra.length ? [{
        code: 'key-extra' as const,
        message: `'${locale}' has ${plural(extra.length)} '${reference}' lacks, so no type names them: ${listKeys(extra)}.`,
      }] : []),
    ];
  };

  const compared = comparable ? locales.filter((locale) => locale !== reference).flatMap(compare) : [];

  return {
    entries,
    skipped: referenceSkipped,
    referenceLocale: reference,
    diagnostics: [
      ...missingExtractor,
      ...(unserved === undefined ? [] : [{
        code: 'locale-unserved' as const,
        message: `The config serves no '${unserved}': the schema follows '${reference}', which /kit negotiates '${unserved}' to. An instance built without /kit starts on no locale.`,
      }]),
      ...failures,
      ...skips,
      ...thrown,
      ...(entries.length || referenceSkipped.length ? [] : [{
        code: 'no-keys' as const,
        message: `No translations were found for '${reference}'. The config names ${Object.keys(probe.translations).map((locale) => `'${locale}'`).join(', ') || 'no locale at all'}.`,
      }]),
      ...compared,
    ],
  };
};
