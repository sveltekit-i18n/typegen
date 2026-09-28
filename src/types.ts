import type { Parser } from '@sveltekit-i18n/base';

export namespace Diagnostic {
  /**
   * Why a generation reported something. An error means the artifact cannot be
   * trusted, so the run writes nothing beyond the placeholder rather than a key
   * set that is quietly short of the real one — types that claim a key exists,
   * or omit one that does, are worse than types that claim nothing.
   *
   * `key-missing`, `key-extra` and `locale-unchecked` compare the other
   * locales with the reference. They are warnings: the schema follows the
   * reference alone, and it is written. `loader-skipped` is a warning too: a
   * loader that cannot run outside the app leaves its namespace open in the
   * schema rather than failing it.
   */
  export type Code =
    | 'config-unreadable'
    | 'config-export-missing'
    | 'core-too-old'
    | 'reference-locale-missing'
    | 'loader-threw'
    | 'loader-skipped'
    | 'no-keys'
    | 'extractor-unreadable'
    | 'extractor-threw'
    | 'key-missing'
    | 'key-extra'
    | 'locale-unchecked';

  export type Severity = 'error' | 'warning';

  export type T = {
    code: Code;
    message: string;
    cause?: unknown;
  };
}

export namespace Options {
  export type T = {
    /**
     * The module holding the app's i18n config, relative to the Vite root. It
     * is evaluated inside the app's own pipeline, so it may use `$lib`, `$env`
     * and every alias the app resolves.
     */
    config: string;
    /** The export carrying the config object. Defaults to `config`. */
    configExport?: string;
    /**
     * The locale whose catalogue defines the key set. Defaults to the config's
     * `initLocale`, then its `fallbackLocale`, then the first locale it names.
     * Other locales are not unioned in: one catalogue is the source of truth,
     * as every comparable generator does it.
     */
    referenceLocale?: string;
    /**
     * Where to write the declarations, relative to the Vite root. Defaults to
     * `src/i18n-schema.d.ts`. Keep it under `src/`: that is where SvelteKit's
     * generated `tsconfig.json` picks a `.d.ts` up. It is build output:
     * gitignore it.
     */
    outFile?: string;
    /**
     * Where to find the parser's build-time extractor, so payloads are typed as
     * well as keys. Without one the keys still narrow and the payload slot
     * stays unchecked.
     */
    extractParams?: ExtractParams;
    /**
     * Whether the other locales are loaded and their keys compared with the
     * reference locale's. Defaults to `true`. `false` runs only the reference
     * locale's loaders and watches only its catalogues — for a remote loader,
     * one request per build instead of one per locale, and no report on a
     * locale kept partial on purpose behind `fallbackLocale`.
     */
    checkLocales?: boolean;
    /** Turns generation off without removing the plugin. Defaults to `true`. */
    enabled?: boolean;
  };

  /**
   * A module specifier resolved in the APP's graph, not this package's — the
   * extractor has to be the one the app's parser ships. `options` are the
   * parser's own: a custom modifier or a disabled tag syntax changes which
   * parameters a message has, so an extractor built with different options
   * reports a different — wrong — set.
   */
  export type ExtractParams = {
    /** The module the extractor factory is imported from, e.g. `sveltekit-i18n`. */
    from: string;
    /** The export the factory is read from. Defaults to `extractParamsFactory`. */
    name?: string;
    /**
     * The options the factory is called with. They cross into the app's
     * graph as JSON, so only JSON data arrives: a function never reaches the
     * extractor.
     */
    options?: unknown;
  };
}

/** One translation key, as the collector derived it from the reference locale. */
export type Entry = {
  key: string;
  value: unknown;
  params: readonly Parser.ParamSpec[] | null;
};

/** A namespace whose loader cannot run outside the app, so no key of it is known. */
export type Skipped = {
  namespace: string;
  /** Under `preprocess: 'none'` the namespace is itself the key. */
  whole: boolean;
};

/** What one collection produced, whether or not it produced an artifact. */
export type Collection = {
  entries: Entry[];
  skipped?: Skipped[];
  referenceLocale: string;
  diagnostics: Diagnostic.T[];
};
