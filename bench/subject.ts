import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as utils from '@sveltekit-i18n/base/utils';
import { extractParamsFactory } from 'sveltekit-i18n';

import type { DeriveInput } from '../src/derive.js';
import type { Collection } from '../src/types.js';

import { LIB } from './collect.ts';
import { LOCALES, table, type Shape, type Table } from './data.ts';

// The modules of the tree measured, as `run.ts` built them.
export const { emit } = await import(pathToFileURL(join(LIB, 'emit.js')).href) as typeof import('../src/emit.js');
export const { derive } = await import(pathToFileURL(join(LIB, 'derive.js')).href) as typeof import('../src/derive.js');

/** The extractor `sveltekit-i18n` ships, as an app names it. */
export const extract = extractParamsFactory({}) as DeriveInput['extract'];

/**
 * A probe that files a table under its locale as the core's default
 * `preprocess` keys it, by the core's own `toDotNotation`: the core's rune
 * modules run only compiled, and what they add to a generation is the core's,
 * not this package's.
 */
export const probe = () => {
  const translations: Record<string, Record<string, unknown>> = {};

  return {
    translations,
    addTranslations: (input: Record<string, Table>) => {
      Object.keys(input).forEach((locale) => {
        translations[locale] = { ...translations[locale], ...utils.toDotNotation(input[locale]) as Record<string, unknown> };
      });
    },
  };
};

/**
 * An app's config of `keys` keys laid out by `shape`, in two locales: flat keys
 * are the config's static table, since a loader's data lands under its
 * namespace, and every other shape has a loader per namespace and locale.
 */
export const config = (keys: number, shape: Shape) => {
  const data = table(keys, shape);

  if (shape === 'flat') return { initLocale: 'en', translations: Object.fromEntries(LOCALES.map((locale) => [locale, data])) };

  return {
    initLocale: 'en',
    loaders: LOCALES.flatMap((locale) => Object.keys(data).map((namespace) => ({ locale, namespace, loader: async () => data[namespace] }))),
  };
};

/** A collection of `config`, as a generation derives it. */
export const collection = (input: Pick<DeriveInput, 'config' | 'probe' | 'extract'>): Promise<Collection> => derive({
  sanitizeLocales: utils.sanitizeLocales,
  resolveLoaders: utils.resolveLoaders as DeriveInput['resolveLoaders'],
  matchLocale: utils.matchLocale,
  ...input,
});
