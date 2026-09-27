import { resolveLoaders } from '@sveltekit-i18n/base/utils';
import { describe, expect, it } from 'vitest';

import { derive as deriveWith } from '../../src/derive.js';
import type { DeriveInput } from '../../src/derive.js';
import { emit, placeholder } from '../../src/emit.js';
import type { Entry } from '../../src/types.js';

const entry = (key: string, value: unknown, params: Entry['params'] = []): Entry => ({ key, value, params });

// The default normalization, standing in for the core's published helper.
const sanitizeLocales = (...locales: unknown[]): string[] => locales.map(String);

// The core the suite installs is 3.1, so its `resolveLoaders` reads the
// loaders unless a spec takes the 3.0 path by leaving it out.
const derive = (input: DeriveInput) => deriveWith({ resolveLoaders: resolveLoaders as DeriveInput['resolveLoaders'], ...input });

const probeFactory = () => {
  const translations: Record<string, Record<string, unknown>> = {};

  return {
    translations,
    calls: [] as unknown[],
    addTranslations(input: any) {
      this.calls.push(input);

      Object.keys(input ?? {}).forEach((locale) => {
        translations[locale] = { ...translations[locale], ...flatten(input[locale]) };
      });
    },
  };
};

// A stand-in for `preprocess: 'full'`, enough to key a namespace by dot notation.
const flatten = (input: unknown, prefix = ''): Record<string, unknown> => {
  if (!input || typeof input !== 'object') return { [prefix]: input };

  return Object.keys(input).reduce<Record<string, unknown>>((acc, key) => ({
    ...acc,
    ...flatten((input as any)[key], prefix ? `${prefix}.${key}` : key),
  }), {});
};

describe('emit', () => {
  it('writes a placeholder that degrades rather than narrows', () => {
    // `HasClosedKeys` reads an EMPTY interface as no schema, so a project
    // compiles before the first generation. An index signature would look
    // equivalent and survive the declaration merge, disabling narrowing for
    // good.
    expect(placeholder()).toContain('interface TranslationSchema {}');
    expect(placeholder()).not.toContain('[key: string]');
    expect(placeholder()).not.toContain('Record<');
  });

  it('types a message without parameters as `never`', () => {
    const { contents } = emit([entry('about', 'About us')], 'en');

    expect(contents).toContain("'about': never;");
  });

  it('leaves the payload unchecked when there is no extractor', () => {
    // `any` routes through the core's `IsAny` branch: the key narrows, the
    // payload slot stays open. `never` would reject a legal call.
    const { contents } = emit([entry('greeting', 'Hi {{name}}', null)], 'en');

    expect(contents).toContain("'greeting': any;");
  });

  it('maps every parameter kind to what the parser accepts', () => {
    const { contents } = emit([entry('all', 'x', [
      { name: 'a' },
      { name: 'b', kind: 'string' },
      { name: 'c', kind: 'number' },
      { name: 'd', kind: 'boolean' },
      { name: 'e', kind: 'date' },
      { name: 'f', kind: 'function' },
    ])], 'en');

    expect(contents).toContain('a: unknown;');
    expect(contents).toContain('b: string;');
    expect(contents).toContain('c: number;');
    expect(contents).toContain('d: boolean;');
    expect(contents).toContain('e: Date | number;');
    expect(contents).toContain('f: (chunks: string[]) => string;');
  });

  it('unions several kinds and parenthesizes them', () => {
    const { contents } = emit([entry('x', 'x', [{ name: 'a', kind: ['string', 'number'] }])], 'en');

    expect(contents).toContain('a: (string) | (number);');
  });

  it('marks an optional parameter optional', () => {
    const { contents } = emit([entry('x', 'x', [{ name: 'a', optional: true }])], 'en');

    expect(contents).toContain('a?: unknown;');
  });

  it('never closes a union on the values a message names', () => {
    // The contract calls `values` a hint and not an exhaustive set — both
    // official parsers fall back to a default branch, so typing by it would
    // reject a legal call.
    const { contents } = emit([entry('x', 'x', [{ name: 'g', values: ['male', 'female'], optional: true }])], 'en');

    expect(contents).toContain('g?: unknown;');
    expect(contents).not.toContain("'male'");
  });

  it('annotates a branch-scoped parameter instead of discriminating it', () => {
    // A discriminated payload would be the product of every nested selector's
    // branches, and the caller pays for that on each keystroke.
    const { contents } = emit([entry('x', 'x', [
      { name: 'name', optional: true, when: [{ param: 'count', branch: 'one' }] },
    ])], 'en');

    expect(contents).toContain('/** used when count is `one` */');
    expect(contents).toContain('name?: unknown;');
  });

  it('quotes what is not an identifier, and only that', () => {
    const { contents } = emit([entry('odd key', 'x', [{ name: 'user.name' }, { name: 'plain' }])], 'en');

    expect(contents).toContain("'odd key':");
    expect(contents).toContain("'user.name': unknown;");
    expect(contents).toContain('plain: unknown;');
  });

  it('escapes a key that would break out of its own quotes', () => {
    const { contents } = emit([entry("it's\\bad", 'x')], 'en');

    expect(contents).toContain("'it\\'s\\\\bad': never;");
  });

  it('keeps a comment from closing itself', () => {
    const { contents } = emit([entry('x', 'a */ b')], 'en');

    expect(contents).toContain('/** a *\\/ b */');
    expect(contents.split('*/').length - 1).toBe(1);
  });

  it('shows a non-string value as JSON and clips a long one', () => {
    const { contents } = emit([entry('n', 42), entry('long', 'x'.repeat(400))], 'en');

    expect(contents).toContain('/** 42 */');
    expect(contents).toContain('…');
    expect(contents.split('\n').every((line) => line.length < 200)).toBe(true);
  });

  it('produces the same bytes for the same catalogue, whatever the order', () => {
    // The write is skipped when the bytes match, so an unstable order would
    // rewrite the file on every run and keep the dev loop going.
    const a = emit([entry('b', '1'), entry('a', '2'), entry('c', '3')], 'en');
    const b = emit([entry('c', '3'), entry('b', '1'), entry('a', '2')], 'en');

    expect(a.contents).toBe(b.contents);
    expect(a.count).toBe(3);
  });

  it('records the reference locale it derived from', () => {
    expect(emit([entry('a', 'x')], 'en-GB').contents).toContain('Reference locale: en-GB');
  });

  it('degrades to no schema when the catalogue is empty', () => {
    expect(emit([], 'en').contents).toContain('interface TranslationSchema {}');
  });
});

describe('derive', () => {
  const loader = (data: unknown) => async () => data;

  it('reads back the keys the core would hold', async () => {
    const probe = probeFactory();
    const collection = await derive({
      probe,
      sanitizeLocales,
      extract: null,
      config: {
        initLocale: 'en',
        translations: { en: { lang: { en: 'English' } } },
        loaders: [{ namespace: 'home', locale: 'en', loader: loader({ title: 'Fixture' }) }],
      },
    });

    expect(collection.referenceLocale).toBe('en');
    expect(collection.entries.map(({ key }) => key).sort()).toEqual(['home.title', 'lang.en']);
    expect(collection.diagnostics).toEqual([]);
  });

  it('applies the static table and the batch in one call each', async () => {
    // The core calls `preprocess` once per load, so a custom one has to see
    // the same input here that it sees there.
    const probe = probeFactory();

    await derive({
      probe,
      sanitizeLocales,
      extract: null,
      config: {
        initLocale: 'en',
        translations: { en: { a: '1' } },
        loaders: [
          { namespace: 'x', locale: 'en', loader: loader({ b: '2' }) },
          { namespace: 'y', locale: 'en', loader: loader({ c: '3' }) },
        ],
      },
    });

    expect(probe.calls).toEqual([{ en: { a: '1' } }, { en: { x: { b: '2' }, y: { c: '3' } } }]);
  });

  it('reads the namespace under the deprecated `key` as well', async () => {
    // The peer range spans cores that accept either name, so a descriptor
    // written the old way has to land under the same namespace.
    const probe = probeFactory();

    await derive({
      probe,
      sanitizeLocales,
      extract: null,
      config: {
        initLocale: 'en',
        loaders: [
          { namespace: 'current', locale: 'en', loader: loader({ a: '1' }) },
          { key: 'legacy', locale: 'en', loader: loader({ b: '2' }) },
        ],
      },
    });

    expect(probe.calls).toEqual([{ en: { current: { a: '1' }, legacy: { b: '2' } } }]);
  });

  it('ignores route scoping so every namespace contributes', async () => {
    // A route-scoped loader carries keys the app reaches on SOME route, and the
    // schema has to describe all of them.
    const seen: unknown[] = [];
    const scoped = (routes: unknown) => ({
      namespace: 'deep',
      locale: 'en',
      routes,
      loader: async (props: unknown) => {
        seen.push(props);

        return { title: 'x' };
      },
    });

    const collection = await derive({
      probe: probeFactory(),
      sanitizeLocales,
      extract: null,
      config: { initLocale: 'en', loaders: [scoped(['/never-visited'])] },
    });

    expect(collection.entries.map(({ key }) => key)).toEqual(['deep.title']);

    // Its own first route, because a loader that reads the route can throw on
    // an empty one, and one that derives keys from it derives the wrong ones.
    expect(seen).toEqual([{ locale: 'en', namespace: 'deep', route: '/never-visited', params: {} }]);

    await derive({
      probe: probeFactory(),
      sanitizeLocales,
      extract: null,
      config: { initLocale: 'en', loaders: [scoped([/^\/shop\/[a-z]+$/]), scoped(undefined)] },
    });

    // A pattern has no route to offer, so the root stands in.
    expect(seen.slice(1)).toEqual([
      { locale: 'en', namespace: 'deep', route: '/', params: {} },
      { locale: 'en', namespace: 'deep', route: '/', params: {} },
    ]);
  });

  it('gives up on a loader that never settles', async () => {
    // The collection runs under a top-level await: one that never settles would
    // hang the build with nothing to read and nothing to report.
    const collection = await derive({
      probe: probeFactory(),
      sanitizeLocales,
      extract: null,
      deadline: 25,
      config: {
        initLocale: 'en',
        translations: { en: { a: '1' } },
        loaders: [{ namespace: 'hangs', locale: 'en', loader: () => new Promise(() => {}) }],
      },
    });

    expect(collection.diagnostics.map(({ code }) => code)).toEqual(['loader-threw']);
    expect(collection.entries.map(({ key }) => key)).toEqual(['a']);
  });

  it('runs only the reference locale', async () => {
    const probe = probeFactory();
    const ran: string[] = [];

    await derive({
      probe,
      sanitizeLocales,
      extract: null,
      config: {
        initLocale: 'en',
        loaders: ['en', 'cs'].map((locale) => ({
          namespace: 'home',
          locale,
          loader: async () => {
            ran.push(locale);

            return { title: locale };
          },
        })),
      },
    });

    expect(ran).toEqual(['en']);
  });

  it('reports a throwing loader instead of swallowing it', async () => {
    // The core fails soft here to keep a page rendering. A key set quietly
    // short of the real one would instead make the types lie.
    const probe = probeFactory();
    const collection = await derive({
      probe,
      sanitizeLocales,
      extract: null,
      config: {
        initLocale: 'en',
        loaders: [
          { namespace: 'ok', locale: 'en', loader: loader({ a: '1' }) },
          { namespace: 'bad', locale: 'en', loader: async () => { throw new Error('boom'); } },
        ],
      },
    });

    expect(collection.diagnostics.map(({ code }) => code)).toEqual(['loader-threw']);
    expect(collection.diagnostics[0].message).toContain("'en' > 'bad'");
    expect(collection.entries.map(({ key }) => key)).toEqual(['ok.a']);
  });

  it('merges two loaders that share a namespace', async () => {
    const probe = probeFactory();
    const collection = await derive({
      probe,
      sanitizeLocales,
      extract: null,
      config: {
        initLocale: 'en',
        loaders: [
          { namespace: 'home', locale: 'en', loader: loader({ nested: { a: '1' } }) },
          { namespace: 'home', locale: 'en', loader: loader({ nested: { b: '2' } }) },
        ],
      },
    });

    expect(collection.entries.map(({ key }) => key).sort()).toEqual(['home.nested.a', 'home.nested.b']);
  });

  it('falls back through initLocale, fallbackLocale and the first locale named', async () => {
    const run = async (config: any) => (await derive({ probe: probeFactory(), sanitizeLocales, extract: null, config })).referenceLocale;

    expect(await run({ initLocale: 'cs', fallbackLocale: 'en', translations: { de: {} } })).toBe('cs');
    expect(await run({ fallbackLocale: 'en', translations: { de: {} } })).toBe('en');
    expect(await run({ translations: { de: { a: '1' } } })).toBe('de');
    expect(await run({ loaders: [{ namespace: 'x', locale: 'sk', loader: loader({ a: '1' }) }] })).toBe('sk');
  });

  it('answers a diagnostic rather than a guess when no locale is named', async () => {
    const collection = await derive({ probe: probeFactory(), sanitizeLocales, extract: null, config: {} });

    expect(collection.diagnostics.map(({ code }) => code)).toEqual(['reference-locale-missing']);
    expect(collection.entries).toEqual([]);
  });

  it('reads any falsy sanitizeLocales but undefined as no normalization, as the core does', async () => {
    const upperCased = (...locales: unknown[]): string[] => locales.map((locale) => String(locale).toUpperCase());

    for (const off of [false, null, 0, '']) {
      const collection = await derive({
        probe: probeFactory(),
        sanitizeLocales: upperCased,
        extract: null,
        config: { initLocale: 'en', sanitizeLocales: off, loaders: [{ namespace: 'x', locale: 'en', loader: loader({ a: '1' }) }] } as any,
      });

      expect(collection.referenceLocale).toBe('en');
      expect(collection.entries.map(({ key }) => key)).toEqual(['x.a']);
    }
  });

  it('honours a custom sanitizeLocales, and degrades when it throws', async () => {
    const upper = async (sanitize: any) => (await derive({
      probe: probeFactory(),
      sanitizeLocales,
      extract: null,
      config: { initLocale: 'en', sanitizeLocales: sanitize, loaders: [{ namespace: 'x', locale: 'en', loader: loader({ a: '1' }) }] },
    }));

    expect((await upper((locale: string) => locale.toUpperCase())).referenceLocale).toBe('EN');
    expect((await upper(() => { throw new Error('nope'); })).referenceLocale).toBe('en');
    expect((await upper(() => '')).referenceLocale).toBe('en');
    expect((await upper(false)).referenceLocale).toBe('en');
  });

  it('keeps a key whose message the extractor cannot read', async () => {
    const collection = await derive({
      probe: probeFactory(),
      sanitizeLocales,
      extract: ((value: any) => {
        if (value === 'bad') throw new Error('unreadable');

        return [{ name: 'a' }];
      }) as any,
      config: { initLocale: 'en', translations: { en: { good: 'fine', bad: 'bad' } } },
    });

    expect(collection.diagnostics.map(({ code }) => code)).toEqual(['extractor-threw']);
    expect(collection.entries.find(({ key }) => key === 'bad')?.params).toBe(null);
    expect(collection.entries.find(({ key }) => key === 'good')?.params).toEqual([{ name: 'a' }]);
  });

  it('reports an empty catalogue instead of writing an empty schema silently', async () => {
    const collection = await derive({
      probe: probeFactory(),
      sanitizeLocales,
      extract: null,
      config: { initLocale: 'en' },
    });

    expect(collection.diagnostics.map(({ code }) => code)).toEqual(['no-keys']);
  });

  it('survives a loader descriptor whose properties throw', async () => {
    const hostile = Object.defineProperty({}, 'key', { get() { throw new Error('nope'); }, enumerable: true });
    const collection = await derive({
      probe: probeFactory(),
      sanitizeLocales,
      extract: null,
      config: {
        initLocale: 'en',
        translations: { en: { a: '1' } },
        loaders: [hostile, { namespace: 'x', locale: 'en', loader: loader({ b: '2' }) }],
      },
    });

    expect(collection.entries.map(({ key }) => key).sort()).toEqual(['a', 'x.b']);
  });

  describe('through the core\'s resolveLoaders', () => {
    const run = (config: any, extra: Record<string, unknown> = {}) => derive({
      probe: probeFactory(),
      sanitizeLocales,
      resolveLoaders: resolveLoaders as any,
      extract: null,
      config,
      ...extra,
    });

    const codes = ({ diagnostics }: { diagnostics: { code: string }[] }) => diagnostics.map(({ code }) => code);

    it('expands a loader that lists several locales and namespaces', async () => {
      const seen: unknown[] = [];
      const collection = await run({
        initLocale: 'en',
        loaders: [{
          namespace: ['home', 'about'],
          locale: ['en', 'cs'],
          loader: async (props: any) => {
            seen.push(props);

            return { title: `${props.locale}/${props.namespace}` };
          },
        }],
      });

      expect(collection.entries.map(({ key, value }) => [key, value]).sort()).toEqual([
        ['about.title', 'en/about'],
        ['home.title', 'en/home'],
      ]);
      expect(seen).toEqual([
        { locale: 'en', namespace: 'home', route: '/', params: {} },
        { locale: 'en', namespace: 'about', route: '/', params: {} },
      ]);
      expect(codes(collection)).toEqual([]);
    });
  });

  describe('on a 3.0 core, which has no resolveLoaders', () => {
    const run = (config: any) => derive({ probe: probeFactory(), sanitizeLocales, resolveLoaders: undefined, extract: null, config });

    it('reads the namespace under `key`, the only name that core knows', async () => {
      const collection = await run({
        initLocale: 'en',
        loaders: [{ key: 'home', locale: 'en', loader: loader({ title: 'x' }) }],
      });

      expect(collection.entries.map(({ key }) => key)).toEqual(['home.title']);
    });

    it('keys a loader without `key` under \'undefined\', as that core does', async () => {
      const collection = await run({
        initLocale: 'en',
        loaders: [{ namespace: 'home', locale: 'en', loader: loader({ title: 'x' }) }],
      });

      expect(collection.entries.map(({ key }) => key)).toEqual(['undefined.title']);
    });
  });
});
