import type { Parser } from '@sveltekit-i18n/base';

import type { Collection, Diagnostic, Entry } from './types.js';

type Descriptor = { namespace?: string; key?: string; locale?: string; routes?: unknown; loader?: (props: { locale: string; route: string }) => unknown };

type Loader = Omit<Descriptor, 'key'>;

type Config = {
  loaders?: readonly unknown[];
  translations?: Record<string, unknown>;
  initLocale?: string;
  fallbackLocale?: string;
  preprocess?: unknown;
  sanitizeLocales?: boolean | ((locale: string) => string);
};

export type Probe = {
  addTranslations: (translations: any) => void;
  translations: Record<string, Record<string, unknown>>;
};

export type DeriveInput = {
  /**
   * Built by the caller from the APP's own copy of the core, carrying the
   * config's `preprocess` and `sanitizeLocales` and nothing else — the key set
   * has to be the one the app's version produces, not this package's.
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

    if (custom === false) return locale;

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

  return Object.keys(source as object).reduce<Record<string, unknown>>((acc, key) => ({
    ...acc,
    [key]: Object.hasOwn(acc, key) ? merge(acc[key], (source as any)[key]) : (source as any)[key],
  }), { ...(target as Record<string, unknown>) });
};

// Loader properties are consumer code and an accessor may throw, so each
// descriptor is materialized on its own. The core accepts the namespace under
// either name, so both are read here and only one leaves.
const readLoaders = (input: readonly unknown[] = []): Loader[] => (
  input.reduce<Loader[]>((acc, descriptor) => {
    try {
      const { namespace, key, locale, routes, loader } = descriptor as Descriptor;

      return [...acc, { namespace: namespace ?? key, locale, routes, loader }];
    } catch {
      return acc;
    }
  }, [])
);

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
 * is the best guess at the catalogue its author keeps complete.
 */
const pickReference = (config: Config, sanitize: (locale: string) => string, requested?: string): string | undefined => {
  const stated = requested ?? config.initLocale ?? config.fallbackLocale;

  if (stated) return sanitize(stated);

  const fromTranslations = Object.keys(config.translations ?? {})[0];
  const fromLoaders = readLoaders(config.loaders).find(({ locale }) => locale)?.locale;
  const found = fromTranslations ?? fromLoaders;

  return found ? sanitize(found) : undefined;
};

/**
 * Runs the config's loaders and reads back the keys the core would hold.
 *
 * Route scoping is bypassed deliberately: a route-scoped loader contributes
 * keys the app reaches on SOME route, and the schema has to describe all of
 * them. A loader that throws is reported rather than skipped — the core
 * swallows one to keep a page rendering, but a key set silently short of the
 * real one would make the types lie.
 */
export const derive = async ({
  probe,
  config,
  configExport = 'config',
  configExports,
  sanitizeLocales,
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

  const sanitize = sanitizerFor(config, sanitizeLocales);
  const reference = pickReference(config, sanitize, referenceLocale);

  if (!reference) {
    return {
      entries: [],
      referenceLocale: referenceLocale ?? '',
      diagnostics: [...missingExtractor, { code: 'reference-locale-missing', message: 'The config names no locale to derive keys from.' }],
    };
  }

  // The core's constructor applies a config's static table in one call of its
  // own, before any load.
  if (config.translations) probe.addTranslations(config.translations);

  const matching = readLoaders(config.loaders).filter(({ locale, loader }) => (
    typeof loader === 'function' && !!locale && sanitize(locale) === reference
  ));

  type Loaded = { descriptor: Loader; data?: unknown; failure?: { cause: unknown } };

  const loaded = await Promise.all(matching.map(async (descriptor): Promise<Loaded> => {
    try {
      return { descriptor, data: await withDeadline(Promise.resolve(descriptor.loader!({ locale: reference, route: routeFor(descriptor) })), deadline) };
    } catch (cause) {
      return { descriptor, failure: { cause } };
    }
  }));

  const failures = loaded.reduce<Diagnostic.T[]>((acc, { descriptor, failure }) => (
    failure ? [...acc, {
      code: 'loader-threw' as const,
      message: `The '${descriptor.locale}' > '${descriptor.namespace}' loader threw, so its keys are missing.`,
      cause: failure.cause,
    }] : acc
  ), []);

  // One batch, one `addTranslations`, as a single visit to every route would
  // have produced. `preprocess` runs once per locale per call, so a custom one
  // that only looks at the leaf it is given sees exactly what the app gives it;
  // one whose output depends on the siblings in the batch is grouping
  // dependent, and no grouping reproduces every route an app can take.
  const batch = loaded.reduce<Record<string, unknown>>((acc, { descriptor, data }) => {
    if (!data) return acc;

    const { namespace } = descriptor;

    if (!namespace) return merge(acc, data) as Record<string, unknown>;

    return { ...acc, [namespace]: Object.hasOwn(acc, namespace) ? merge(acc[namespace], data) : data };
  }, {});

  if (Object.keys(batch).length) probe.addTranslations({ [reference]: batch });

  const table = probe.translations[reference] ?? {};

  // One message the extractor cannot read costs its own payload, not the whole
  // artifact: the key still narrows, its payload stays unchecked.
  const readOne = (key: string): { entry: Entry; thrown?: Diagnostic.T } => {
    const value = table[key];

    if (!extract) return { entry: { key, value, params: null } };

    try {
      return { entry: { key, value, params: [...extract(value as any, { key, locale: reference })] } };
    } catch (cause) {
      return {
        entry: { key, value, params: null },
        thrown: { code: 'extractor-threw', message: `The extractor threw on '${key}'.`, cause },
      };
    }
  };

  const read = Object.keys(table).map(readOne);
  const entries = read.map(({ entry }) => entry);
  const thrown = read.reduce<Diagnostic.T[]>((acc, { thrown: one }) => (one ? [...acc, one] : acc), []);

  return {
    entries,
    referenceLocale: reference,
    diagnostics: [
      ...missingExtractor,
      ...failures,
      ...thrown,
      ...(entries.length ? [] : [{
        code: 'no-keys' as const,
        message: `No translations were found for '${reference}'. The config names ${Object.keys(probe.translations).map((locale) => `'${locale}'`).join(', ') || 'no locale at all'}.`,
      }]),
    ],
  };
};
