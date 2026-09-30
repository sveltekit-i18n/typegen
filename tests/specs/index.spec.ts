import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

import { matchLocale, resolveLoaders } from '@sveltekit-i18n/base/utils';
import { build } from 'vite';
import type { Plugin } from 'vite';
import { describe, expect, it, vi } from 'vitest';

import { collect } from '../../src/collect.js';
import type { Collected } from '../../src/collect.js';

import { derive as deriveWith } from '../../src/derive.js';
import type { DeriveInput } from '../../src/derive.js';
import { emit, placeholder } from '../../src/emit.js';
import { typegen } from '../../src/plugin.js';
import type { Entry } from '../../src/types.js';
import { writeIfChanged } from '../../src/write.js';

// The plugin's own bookkeeping is driven in process; the collection it starts
// is a real Vite pipeline, which `plugin.spec.ts` covers.
vi.mock('../../src/collect.js', () => ({
  collect: vi.fn(async () => ({ collection: { entries: [], referenceLocale: 'en', diagnostics: [] }, dependencies: [] })),
}));

vi.mock('../../src/write.js', async (original) => ({
  writeIfChanged: vi.fn((await original<typeof import('../../src/write.js')>()).writeIfChanged),
}));

const entry = (key: string, value: unknown, params: Entry['params'] = []): Entry => ({ key, value, params });

// The default normalization, standing in for the core's published helper.
const sanitizeLocales = (...locales: unknown[]): string[] => locales.map(String);

// The core the suite installs is 3.1, so its `resolveLoaders` reads the
// loaders and its `matchLocale` settles the reference, unless a spec takes the
// 3.0 path by leaving them out.
const derive = (input: DeriveInput) => deriveWith({ resolveLoaders: resolveLoaders as DeriveInput['resolveLoaders'], matchLocale, ...input });

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

// A stand-in for `preprocess: 'none'` under one call per locale: `flatten`
// grows with the square of the keys, which a timed test cannot afford.
const assigningProbe = () => ({
  translations: {} as Record<string, Record<string, unknown>>,
  addTranslations(input: any) {
    Object.assign(this.translations, input);
  },
});

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

  it('reads a kind the table lacks as unknown, a prototype name included', () => {
    const { contents } = emit([entry('x', 'x', [{ name: 'a', kind: 'constructor' as any }, { name: 'b', kind: 'toString' as any }])], 'en');

    expect(contents).toContain('a: unknown;');
    expect(contents).toContain('b: unknown;');
  });

  it('escapes a line terminator in a key and a parameter name', () => {
    const { contents } = emit([entry('a\nb\rc', 'x', [{ name: 'd\ne' }])], 'en');

    expect(contents).toContain("'a\\nb\\rc': {");
    expect(contents).toContain("'d\\ne': unknown;");
  });

  it('escapes a line terminator in a namespace a pattern member names', () => {
    const { contents } = emit([], 'en', [{ namespace: 'a\rb\nc', whole: false }]);

    expect(contents).toContain('[key: `a\\rb\\nc.${string}`]: any;');
  });

  it('keeps a branch from closing the comment it is named in', () => {
    const { contents } = emit([entry('x', 'x', [{ name: 'a', when: [{ param: 'p*/', branch: '*/' }] }])], 'en');

    expect(contents).toContain('/** used when p*\\/ is `*\\/` */');
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

  it('leaves undescribed a value JSON cannot hold', () => {
    const circular: Record<string, unknown> = {};

    circular.self = circular;

    const { contents } = emit([entry('big', 1n), entry('loop', circular)], 'en');

    expect(contents).toContain("  'big': never;");
    expect(contents).toContain("  'loop': never;");
    expect(contents).not.toContain('/**');
  });

  it('produces the same bytes for the same catalogue, whatever the order', () => {
    // The write is skipped when the bytes match, so an unstable order would
    // rewrite the file on every run and keep the dev loop going.
    const a = emit([entry('b', '1'), entry('a', '2'), entry('c', '3')], 'en');
    const b = emit([entry('c', '3'), entry('b', '1'), entry('a', '2')], 'en');

    expect(a.contents).toBe(b.contents);
    expect(a.count).toBe(3);
  });

  it('writes a mixed catalogue byte for byte', () => {
    const { contents, count } = emit([
      entry('nav.home', 'Home', null),
      entry('about', 'About us'),
      entry('greeting', 'Hello {name}', [{ name: 'name', kind: 'string' }]),
      entry('cart.items', '{count, plural, one {# item} other {# items}}', [
        { name: 'count', kind: 'number' },
        { name: 'total', kind: ['number', 'string'], optional: true, when: [{ param: 'count', branch: 'other' }] },
      ]),
      entry("it's\nodd", 'a */ b', [{ name: 'on-date', kind: 'date' }]),
      entry('data', { nested: true }),
    ], 'en', [{ namespace: 'remote', whole: false }, { namespace: 'legacy', whole: true }]);

    expect(contents).toBe([
      '// Generated by @sveltekit-i18n/typegen. Do not edit, and do not commit.',
      '// Reference locale: en',
      '',
      'interface TranslationSchema {',
      '  /** About us */',
      "  'about': never;",
      '  /** {count, plural, one {# item} other {# items}} */',
      "  'cart.items': {",
      '    count: number;',
      '    /** used when count is `other` */',
      '    total?: (number) | (string);',
      '  };',
      '  /** {"nested":true} */',
      "  'data': never;",
      '  /** Hello {name} */',
      "  'greeting': {",
      '    name: string;',
      '  };',
      '  /** a *\\/ b */',
      "  'it\\'s\\nodd': {",
      "    'on-date': Date | number;",
      '  };',
      '  /** Home */',
      "  'nav.home': any;",
      '  /** Not read: its loader cannot run outside the app. */',
      "  'legacy': any;",
      '  /** Not read: its loader cannot run outside the app. */',
      '  [key: `remote.${string}`]: any;',
      '}',
      '',
      'declare namespace SvelteKitI18n {',
      '  interface Register {',
      '    schema: TranslationSchema;',
      '  }',
      '}',
      '',
    ].join('\n'));
    expect(count).toBe(6);
  });

  // Tens of milliseconds when each line is appended once; seconds when the
  // lines so far are copied for every key or parameter. The bound follows the
  // core's own bounded-time tests.
  it('emits many keys in bounded time', () => {
    const keys = Array.from({ length: 20000 }, (_, i) => entry(`n.k${i}`, 'x', [{ name: 'a' }]));
    const start = performance.now();

    expect(emit(keys, 'en').count).toBe(20000);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('emits a message of many parameters in bounded time', () => {
    const params = Array.from({ length: 20000 }, (_, i) => ({ name: `p${i}`, when: [{ param: 'c', branch: 'one' }] }));
    const start = performance.now();

    expect(emit([entry('k', 'x', params)], 'en').contents).toContain('p19999: unknown;');
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('records the reference locale it derived from', () => {
    expect(emit([entry('a', 'x')], 'en-GB').contents).toContain('Reference locale: en-GB');
  });

  it('opens a skipped namespace to any key under it, escaped for a template type', () => {
    const { contents } = emit([entry('home.title', 'x')], 'en', [{ namespace: 'a`b${c}\\', whole: false }]);

    expect(contents).toContain('[key: `a\\`b\\${c}\\\\.${string}`]: any;');
    expect(contents).toContain("'home.title': never;");
  });

  it('types a skipped namespace as one key when the keys are not dotted', () => {
    expect(emit([], 'en', [{ namespace: 'post', whole: true }]).contents).toContain("'post': any;");
  });

  it('degrades to no schema when the catalogue is empty', () => {
    expect(emit([], 'en').contents).toContain('interface TranslationSchema {}');
  });

  // A 3.1 core types a config without a `schema` by this registration; 3.0
  // ignores it. It is fixed text, so it keeps the bytes stable.
  const REGISTER = [
    'declare namespace SvelteKitI18n {',
    '  interface Register {',
    '    schema: TranslationSchema;',
    '  }',
    '}',
    '',
  ].join('\n');

  it('registers the schema after the interface', () => {
    const { contents } = emit([entry('b', '1'), entry('a', '2')], 'en');

    expect(contents.endsWith(`\n}\n\n${REGISTER}`)).toBe(true);
    expect(contents.split(REGISTER)).toHaveLength(2);
  });

  it('registers the empty placeholder, which differs from an empty artifact only by the locale line', () => {
    expect(placeholder()).toBe([
      '// Generated by @sveltekit-i18n/typegen. Do not edit, and do not commit.',
      '',
      'interface TranslationSchema {}',
      '',
      REGISTER,
    ].join('\n'));
    expect(emit([], 'en').contents).toBe(placeholder().replace('\n\n', '\n// Reference locale: en\n\n'));
  });

  it('carries no top-level import or export', () => {
    // One would turn the artifact into a module, and the global it declares
    // and registers would vanish.
    const topLevel = (text: string) => text.split('\n').some((line) => /^\s*(import|export)\b/.test(line));

    expect(topLevel(emit([entry('a', 'x', [{ name: 'd', kind: 'date' }])], 'en').contents)).toBe(false);
    expect(topLevel(placeholder())).toBe(false);
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

  it('runs only the reference locale when told not to compare', async () => {
    const probe = probeFactory();
    const ran: string[] = [];

    const collection = await derive({
      probe,
      sanitizeLocales,
      extract: null,
      checkLocales: false,
      config: {
        initLocale: 'en',
        loaders: ['en', 'cs'].map((locale) => ({
          namespace: 'home',
          locale,
          loader: async () => {
            ran.push(locale);

            return locale === 'en' ? { title: locale } : {};
          },
        })),
      },
    });

    expect(ran).toEqual(['en']);
    expect(collection.diagnostics).toEqual([]);
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

  it('merges two loaders of a wide namespace in bounded time', async () => {
    const probe = assigningProbe();
    const wide = (from: number) => Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${from + i}`, 'v']));
    const started = performance.now();

    await derive({
      probe,
      sanitizeLocales,
      extract: null,
      config: {
        initLocale: 'en',
        loaders: [
          { namespace: 'home', locale: 'en', loader: loader(wide(0)) },
          { namespace: 'home', locale: 'en', loader: loader(wide(5000)) },
        ],
      },
    });

    expect(performance.now() - started).toBeLessThan(1000);
    expect(Object.keys(probe.translations.en.home as object)).toHaveLength(10000);
  });

  it('keeps a prototype-named key a loader adds to a shared namespace', async () => {
    const collection = await derive({
      probe: probeFactory(),
      sanitizeLocales,
      extract: null,
      config: {
        initLocale: 'en',
        loaders: [
          { namespace: 'home', locale: 'en', loader: loader({ x: '1', n: { x: '1' } }) },
          { namespace: 'home', locale: 'en', loader: loader(JSON.parse('{ "__proto__": { "b": "2" }, "n": { "__proto__": { "c": "3" } } }')) },
        ],
      },
    });

    expect(collection.entries.map(({ key }) => key).sort()).toEqual(['home.__proto__.b', 'home.n.__proto__.c', 'home.n.x', 'home.x']);
  });

  it('merges two loaders without writing into what either returned', async () => {
    const first = { a: '1', nested: { a: '1' } };
    const second = { b: '2', nested: { b: '2' } };

    await derive({
      probe: probeFactory(),
      sanitizeLocales,
      extract: null,
      config: {
        initLocale: 'en',
        loaders: [
          { namespace: 'home', locale: 'en', loader: loader(first) },
          { namespace: 'home', locale: 'en', loader: loader(second) },
        ],
      },
    });

    expect(first).toEqual({ a: '1', nested: { a: '1' } });
    expect(second).toEqual({ b: '2', nested: { b: '2' } });
  });

  it('falls back through initLocale, fallbackLocale and the first locale named', async () => {
    const run = async (config: any) => (await derive({ probe: probeFactory(), sanitizeLocales, extract: null, config })).referenceLocale;

    expect(await run({ initLocale: 'cs', fallbackLocale: 'en', translations: { de: {} } })).toBe('cs');
    expect(await run({ fallbackLocale: 'en', translations: { de: {} } })).toBe('en');
    expect(await run({ translations: { de: { a: '1' } } })).toBe('de');
    expect(await run({ loaders: [{ namespace: 'x', locale: 'sk', loader: loader({ a: '1' }) }] })).toBe('sk');
  });

  it('takes the served locale a regional initLocale negotiates to, as /kit does', async () => {
    const collection = await derive({
      probe: probeFactory(),
      sanitizeLocales,
      extract: null,
      config: {
        initLocale: 'en-US',
        loaders: [
          { namespace: 'home', locale: 'en', loader: loader({ a: '1' }) },
          { namespace: 'home', locale: 'cs', loader: loader({ a: '1' }) },
        ],
      },
    });

    expect(collection.referenceLocale).toBe('en');
    expect(collection.entries.map(({ key }) => key)).toEqual(['home.a']);
    expect(collection.diagnostics.map(({ code }) => code)).toEqual(['locale-unserved']);
    expect(collection.diagnostics[0].message).toContain("'en-US'");
  });

  it('keeps a served initLocale that is no language range', async () => {
    const collection = await derive({
      probe: probeFactory(),
      sanitizeLocales,
      extract: null,
      config: {
        sanitizeLocales: false,
        initLocale: 'en_US',
        fallbackLocale: 'de',
        loaders: [
          { namespace: 'home', locale: 'en_US', loader: loader({ a: '1' }) },
          { namespace: 'home', locale: 'de', loader: loader({ a: '1' }) },
        ],
      },
    });

    expect(collection.referenceLocale).toBe('en_US');
  });

  it('says nothing of a regional initLocale when the fallbackLocale is served as stated', async () => {
    const collection = await derive({
      probe: probeFactory(),
      sanitizeLocales,
      extract: null,
      config: {
        initLocale: 'en-US',
        fallbackLocale: 'cs',
        loaders: [
          { namespace: 'home', locale: 'en', loader: loader({ a: '1' }) },
          { namespace: 'home', locale: 'cs', loader: loader({ a: '1' }) },
        ],
      },
    });

    expect(collection.referenceLocale).toBe('en');
    expect(collection.diagnostics).toEqual([]);
  });

  it('settles on the fallbackLocale when the initLocale negotiates to nothing served', async () => {
    const collection = await derive({
      probe: probeFactory(),
      sanitizeLocales,
      extract: null,
      config: {
        initLocale: 'de',
        fallbackLocale: 'cs',
        loaders: [
          { namespace: 'home', locale: 'en', loader: loader({ a: '1' }) },
          { namespace: 'home', locale: 'cs', loader: loader({ a: '1' }) },
        ],
      },
    });

    expect(collection.referenceLocale).toBe('cs');
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

  it('files the static table under the locales sanitized once', async () => {
    // The probe sanitizes nothing, since a second pass of a custom
    // `sanitizeLocales` need not be a no-op: every table reaches it filed
    // where the core files it.
    const probe = probeFactory();
    const collection = await derive({
      probe,
      sanitizeLocales,
      extract: null,
      config: {
        initLocale: 'en',
        sanitizeLocales: (locale: string) => ({ en: 'en-US' } as Record<string, string>)[locale] ?? locale.toLowerCase(),
        translations: { en: { lang: { en: 'English' } } },
        loaders: [{ namespace: 'home', locale: 'en', loader: loader({ title: 'x' }) }],
      },
    });

    expect(collection.referenceLocale).toBe('en-US');
    expect(Object.keys(probe.translations)).toEqual(['en-US']);
    expect(collection.entries.map(({ key }) => key).sort()).toEqual(['home.title', 'lang.en']);
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

  it.each([
    ['a non-object', [null]],
    ['a nameless parameter', [{ kind: 'string' }]],
    ['a non-string name', [{ name: 1 }]],
    ['a non-array condition', [{ name: 'a', when: 'count' }]],
    ['a malformed condition', [{ name: 'a', when: [{ param: 'count' }] }]],
  ])('keeps a key whose parameters the extractor returned as %s', async (_, params) => {
    const collection = await derive({
      probe: probeFactory(),
      sanitizeLocales,
      extract: ((value: any) => (value === 'bad' ? params : [{ name: 'a' }])) as any,
      config: { initLocale: 'en', translations: { en: { good: 'fine', bad: 'bad' } } },
    });

    expect(collection.diagnostics.map(({ code }) => code)).toEqual(['extractor-threw']);
    expect(collection.entries.find(({ key }) => key === 'bad')?.params).toBe(null);
    expect(collection.entries.find(({ key }) => key === 'good')?.params).toEqual([{ name: 'a' }]);
    expect(() => emit(collection.entries, collection.referenceLocale)).not.toThrow();
  });

  it('collects what the extractor cannot read in bounded time, in key order', async () => {
    const keys = Array.from({ length: 40000 }, (_, i) => `k${i}`);
    const started = performance.now();
    const collection = await derive({
      probe: assigningProbe(),
      sanitizeLocales,
      extract: (() => [null]) as any,
      config: { initLocale: 'en', translations: { en: Object.fromEntries(keys.map((key) => [key, 'v'])) } },
    });

    expect(performance.now() - started).toBeLessThan(1000);
    expect(collection.diagnostics.map(({ message }) => message)).toEqual(keys.map((key) => `The extractor returned no parameter list for '${key}'.`));
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
      }, { checkLocales: false });

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

    it('reports the keys another locale lacks, and those only it has', async () => {
      const keys = (count: number, prefix: string) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`${prefix}${String(i).padStart(2, '0')}`, 'x']));
      const collection = await run({
        initLocale: 'en',
        loaders: [
          { namespace: 'n', locale: 'en', loader: async () => ({ ...keys(14, 'k'), shared: 'x' }) },
          { namespace: 'n', locale: 'cs', loader: async () => ({ ...keys(2, 'k'), shared: 'x', only: 'x' }) },
          { namespace: 'n', locale: 'de', loader: async () => ({ ...keys(14, 'k'), shared: 'x' }) },
        ],
      });

      expect(collection.entries).toHaveLength(15);
      expect(codes(collection)).toEqual(['key-missing', 'key-extra']);

      const [missing, extra] = collection.diagnostics;

      expect(missing.message).toBe("'cs' lacks 12 keys the reference 'en' has: 'n.k02', 'n.k03', 'n.k04', 'n.k05', 'n.k06', 'n.k07', 'n.k08', 'n.k09', 'n.k10', 'n.k11' and 2 more.");
      expect(extra.message).toBe("'cs' has 1 key 'en' lacks, so no type names them: 'n.only'.");
    });

    it('says a missing key renders from the fallback locale', async () => {
      const collection = await run({
        initLocale: 'cs',
        fallbackLocale: 'en',
        loaders: [
          { namespace: 'n', locale: 'cs', loader: async () => ({ a: 'x', b: 'x' }) },
          { namespace: 'n', locale: 'en', loader: async () => ({ a: 'x', b: 'x' }) },
          { namespace: 'n', locale: 'de', loader: async () => ({ a: 'x' }) },
        ],
      });

      expect(collection.diagnostics.map(({ message }) => message)).toEqual(["'de' lacks 1 key the reference 'cs' has: 'n.b'. They render from 'en'."]);
    });

    it('leaves a locale whose loader threw uncompared, and writes the schema', async () => {
      const collection = await run({
        initLocale: 'en',
        loaders: [
          { namespace: 'n', locale: 'en', loader: async () => ({ a: 'x' }) },
          { namespace: 'n', locale: 'cs', loader: async () => { throw new Error('offline'); } },
          { namespace: 'm', locale: 'cs', loader: async () => ({ other: 'x' }) },
        ],
      });

      expect(codes(collection)).toEqual(['locale-unchecked']);
      expect(collection.diagnostics[0].message).toBe("The 'cs' > 'n' loader threw, so 'cs' was not compared with 'en'.");
      expect(collection.entries.map(({ key }) => key)).toEqual(['n.a']);
    });

    it('compares nothing when the reference itself is short of keys', async () => {
      const collection = await run({
        initLocale: 'en',
        loaders: [
          { namespace: 'n', locale: 'en', loader: async () => ({ a: 'x' }) },
          { namespace: 'm', locale: 'en', loader: async () => { throw new Error('offline'); } },
          { namespace: 'm', locale: 'cs', loader: async () => ({ b: 'x' }) },
        ],
      });

      expect(codes(collection)).toEqual(['loader-threw']);
    });

    it('does not compare a locale that is only seeded', async () => {
      const collection = await run({
        initLocale: 'en',
        translations: { en: { lang: { en: 'English', cs: 'Čeština' } }, de: { lang: { de: 'Deutsch' } } },
        loaders: [{ namespace: 'n', locale: 'en', loader: async () => ({ a: 'x' }) }],
      });

      expect(codes(collection)).toEqual([]);
    });

    it('compares the keys the core holds, array items included', async () => {
      const collection = await run({
        initLocale: 'en',
        loaders: [
          { namespace: 'n', locale: 'en', loader: async () => ({ bullets: ['a', 'b', 'c'] }) },
          { namespace: 'n', locale: 'cs', loader: async () => ({ bullets: ['a', 'b'] }) },
        ],
      });

      expect(collection.diagnostics.map(({ message }) => message)).toEqual(["'cs' lacks 1 key the reference 'en' has: 'n.bullets.2'."]);
    });

    it('runs every locale at once, so one deadline bounds them all', async () => {
      // The reference's loader settles only once the other locale's has
      // started: run one after the other, the collection would miss the
      // deadline instead.
      let started = (): void => {};
      const other = new Promise<void>((resolve) => {
        started = resolve;
      });

      const collection = await run({
        initLocale: 'en',
        loaders: [
          { namespace: 'n', locale: 'en', loader: async () => { await other; return { a: 'x' }; } },
          { namespace: 'n', locale: 'cs', loader: () => { started(); return new Promise(() => {}); } },
        ],
      }, { deadline: 1_000 });

      expect(codes(collection)).toEqual(['locale-unchecked']);
      expect(collection.entries.map(({ key }) => key)).toEqual(['n.a']);
    });
    it('leaves a locale whose catalogue the core cannot take uncompared, and writes the schema', async () => {
      const probe = probeFactory();
      const add = probe.addTranslations.bind(probe);

      probe.addTranslations = (input: any) => {
        if (input.cs) throw new Error('malformed');

        add(input);
      };

      const collection = await derive({
        probe,
        sanitizeLocales,
        extract: null,
        config: {
          initLocale: 'en',
          loaders: [
            { namespace: 'n', locale: 'en', loader: async () => ({ a: 'x' }) },
            { namespace: 'n', locale: 'cs', loader: async () => ({ a: null }) },
          ],
        },
      });

      expect(collection.diagnostics.map(({ code, message }) => [code, message])).toEqual([
        ['locale-unchecked', "The 'cs' catalogue could not be applied, so 'cs' was not compared with 'en'."],
      ]);
      expect(collection.entries.map(({ key }) => key)).toEqual(['n.a']);
    });

    it('names only the missing keys the fallback locale has', async () => {
      const collection = await run({
        initLocale: 'en',
        fallbackLocale: 'de',
        loaders: [
          { namespace: 'n', locale: 'en', loader: async () => ({ a: 'x', b: 'x', c: 'x' }) },
          { namespace: 'n', locale: 'de', loader: async () => ({ a: 'x', b: 'x' }) },
          { namespace: 'n', locale: 'fr', loader: async () => ({ a: 'x' }) },
        ],
      });

      expect(collection.diagnostics.map(({ message }) => message)).toEqual([
        "'de' lacks 1 key the reference 'en' has: 'n.c'.",
        "'fr' lacks 2 keys the reference 'en' has: 'n.b', 'n.c'. 1 of them render from 'de'.",
      ]);
    });
  });

  describe('a loader that cannot run outside the app', () => {
    const requestStore = async () => {
      throw new Error('Could not get the request store. This is an internal error.');
    };

    const withParams = async ({ params }: { params: Record<string, string> }) => {
      if (!params.slug) throw new Error('No slug.');

      return { title: 'x' };
    };

    const run = (config: any) => derive({ probe: probeFactory(), sanitizeLocales, extract: null, config: { initLocale: 'en', ...config } });

    it('skips a loader that needs a request, and writes the rest', async () => {
      const collection = await run({
        loaders: [
          { namespace: 'home', locale: 'en', loader: loader({ title: 'x' }) },
          { namespace: 'post', locale: 'en', cache: false, loader: requestStore },
        ],
      });

      expect(collection.entries.map(({ key }) => key)).toEqual(['home.title']);
      expect(collection.skipped).toEqual([{ namespace: 'post', whole: false }]);
      expect(collection.diagnostics.map(({ code }) => code)).toEqual(['loader-skipped']);
    });

    it('skips a loader whose routes capture params', async () => {
      const collection = await run({
        loaders: [
          { namespace: 'home', locale: 'en', loader: loader({ title: 'x' }) },
          { namespace: 'post', locale: 'en', routes: [/^\/blog\/(?<slug>[^/]+)$/], loader: withParams },
        ],
      });

      expect(collection.skipped).toEqual([{ namespace: 'post', whole: false }]);
      expect(collection.diagnostics.map(({ code }) => code)).toEqual(['loader-skipped']);
    });

    it('still fails on any other throw, whatever the loader', async () => {
      const collection = await run({
        loaders: [{ namespace: 'post', locale: 'en', cache: false, loader: async () => { throw new Error('Offline.'); } }],
      });

      expect(collection.skipped ?? []).toEqual([]);
      expect(collection.diagnostics.map(({ code }) => code)).toContain('loader-threw');
    });

    it('types the namespace as one key under `preprocess: \'none\'`', async () => {
      const collection = await run({
        preprocess: 'none',
        loaders: [{ namespace: 'post', locale: 'en', loader: requestStore }],
      });

      expect(collection.skipped).toEqual([{ namespace: 'post', whole: true }]);
    });

    it('fails under a custom preprocess, which no key shape can be guessed for', async () => {
      const collection = await run({
        preprocess: (input: unknown) => input,
        loaders: [{ namespace: 'post', locale: 'en', loader: requestStore }],
      });

      expect(collection.diagnostics.map(({ code }) => code)).toContain('loader-threw');
    });

    it('fails on an empty namespace, whose keys carry no prefix to open', async () => {
      const collection = await run({ loaders: [{ namespace: '', locale: 'en', loader: requestStore }] });

      expect(collection.diagnostics.map(({ code }) => code)).toContain('loader-threw');
    });

    it('opens an empty namespace under `preprocess: \'none\'`, where it is the key', async () => {
      const collection = await run({ preprocess: 'none', loaders: [{ namespace: '', locale: 'en', loader: requestStore }] });

      expect(collection.skipped).toEqual([{ namespace: '', whole: true }]);
    });

    it('names each locale once, however many of its loaders were skipped', async () => {
      const collection = await run({
        loaders: [
          { namespace: 'post', locale: 'en', loader: requestStore },
          { namespace: 'post', locale: 'en', cache: false, loader: requestStore },
        ],
      });

      expect(collection.diagnostics[0].message).toContain("('en')");
    });

    it('writes a schema when every loader was skipped', async () => {
      const collection = await run({ loaders: [{ namespace: 'post', locale: 'en', loader: requestStore }] });

      expect(collection.diagnostics.map(({ code }) => code)).toEqual(['loader-skipped']);
    });

    it('still compares the other namespaces of the other locales', async () => {
      const collection = await run({
        loaders: [
          { namespace: 'home', locale: 'en', loader: loader({ title: 'x', lead: 'x' }) },
          { namespace: 'home', locale: 'cs', loader: loader({ title: 'x' }) },
          { namespace: 'post', locale: ['en', 'cs'], loader: requestStore },
        ],
      });

      expect(collection.diagnostics.map(({ code }) => code)).toEqual(['loader-skipped', 'key-missing']);
      expect(collection.diagnostics[1].message).toContain("'home.lead'");
    });
  });

  describe('on a 3.0 core, which has no resolveLoaders', () => {
    const run = (config: any) => derive({ probe: probeFactory(), sanitizeLocales, resolveLoaders: undefined, extract: null, config });

    it('reads the namespace under `key`, the only name that core knows', async () => {
      const collection = await run({
        initLocale: 'en',
        loaders: [
          { key: 'home', locale: 'en', loader: loader({ title: 'x' }) },
          { key: 'home', locale: 'cs', loader: loader({ title: 'x', only: 'x' }) },
        ],
      });

      expect(collection.entries.map(({ key }) => key)).toEqual(['home.title']);
      expect(collection.diagnostics.map(({ code }) => code)).toEqual(['key-extra']);
    });

    it('keys a loader without `key` under \'undefined\', as that core does', async () => {
      const collection = await run({
        initLocale: 'en',
        loaders: [{ locale: 'en', loader: loader({ title: 'x' }) }],
      });

      expect(collection.entries.map(({ key }) => key)).toEqual(['undefined.title']);
    });

    it.each([
      ['a `namespace`', { namespace: 'home', locale: 'en' }],
      ['an array of locales', { key: 'home', locale: ['en', 'cs'] }],
    ])('refuses a loader spelled for 3.1, with %s, and names the core it found', async (_, descriptor) => {
      const collection = await derive({
        probe: probeFactory(),
        sanitizeLocales,
        resolveLoaders: undefined,
        coreLocation: '/app/node_modules/@sveltekit-i18n/base/dist/index.js',
        extract: null,
        config: { initLocale: 'en', loaders: [{ ...descriptor, loader: loader({ title: 'x' }) }] },
      });

      expect(collection.entries).toEqual([]);
      expect(collection.diagnostics.map(({ code }) => code)).toEqual(['core-too-old']);
      expect(collection.diagnostics[0].message).toContain('/app/node_modules/@sveltekit-i18n/base/dist/index.js');
    });

    it('sanitizes a loader\'s locale once, as 3.1 loads it', async () => {
      // 3.0 sanitizes the requested locale a second time, so under a custom
      // `sanitizeLocales` that changes its own output it never runs this
      // loader; the schema types what the config states instead.
      const collection = await run({
        initLocale: 'en',
        sanitizeLocales: (locale: string) => ({ en: 'en-US' } as Record<string, string>)[locale] ?? locale.toLowerCase(),
        loaders: [{ key: 'home', locale: 'en', loader: loader({ title: 'x' }) }],
      });

      expect(collection.referenceLocale).toBe('en-US');
      expect(collection.entries.map(({ key }) => key)).toEqual(['home.title']);
    });
  });
});

describe('the build claim', () => {
  type Hook = (...args: unknown[]) => unknown;

  const call = (plugin: ReturnType<typeof typegen>, name: string, ...args: unknown[]) => {
    const hook = plugin[name as keyof typeof plugin] as Hook | { handler: Hook } | undefined;

    return (typeof hook === 'object' ? hook.handler : hook)?.call({ warn: () => {} }, ...args);
  };

  const instance = (root: string) => {
    const plugin = typegen({ config: 'src/i18n.js', outFile: 'schema.d.ts' });

    call(plugin, 'configResolved', { root, command: 'build' });

    return plugin;
  };

  it('lets the next round of a watcher generate after one that never closed its bundle', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'typegen-'));

    vi.mocked(collect).mockClear();

    try {
      const outer = instance(root);

      await call(outer, 'buildStart');
      // SvelteKit's client build, from the config file loaded again.
      await call(instance(root), 'buildStart');

      expect(collect).toHaveBeenCalledTimes(1);

      // The round failed while writing its bundle, so no `closeBundle`; the
      // watcher answers the next change with a new round, run by the same
      // instance on the same resolved config.
      call(outer, 'watchChange', resolve(root, 'src/i18n.js'), { event: 'update' });

      await call(outer, 'buildStart');

      expect(collect).toHaveBeenCalledTimes(2);

      await call(outer, 'closeBundle');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('lets the next build generate after a plugin before it failed to close its bundle', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'typegen-'));
    // An adapter, run by the plugin listed before this one, that fails.
    const adapter: Plugin = { name: 'adapter', closeBundle: () => { throw new Error('Adapter failed.'); } };
    const once = () => build({
      root,
      logLevel: 'silent',
      configFile: false,
      plugins: [adapter, typegen({ config: 'src/i18n.js', outFile: 'schema.d.ts' })],
      build: { lib: { entry: 'main.js', formats: ['es'] }, write: false },
    }).catch(() => undefined);

    vi.mocked(collect).mockClear();

    try {
      await writeFile(resolve(root, 'main.js'), 'export default 1;\n', 'utf8');
      await once();
      await once();

      expect(collect).toHaveBeenCalledTimes(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('a dev server\'s generation', () => {
  it.each([
    ['writes for a server that still serves', false],
    ['leaves the artifact to the server that replaced it', true],
  ])('%s', async (_, closed) => {
    const root = await mkdtemp(resolve(tmpdir(), 'typegen-'));
    const collection = { entries: [entry('late', 'late')], referenceLocale: 'en', diagnostics: [], skipped: [] };
    let finish: (collected: Collected) => void = () => {};

    vi.mocked(collect).mockClear().mockImplementationOnce(() => new Promise((done) => { finish = done; }));
    vi.mocked(writeIfChanged).mockClear();

    try {
      const plugin = typegen({ config: 'src/i18n.js', outFile: 'schema.d.ts' });
      const watcher = Object.assign(new EventEmitter(), { add: () => watcher });
      const server = {
        watcher,
        config: { experimental: {}, logger: { warn: () => {}, error: () => {} } },
        environments: { client: { pluginContainer: { buildStart: async () => {} } } },
      };
      const hook = (name: 'configResolved' | 'configureServer' | 'buildStart', self: unknown, ...args: unknown[]) => (
        (plugin[name] as (...rest: unknown[]) => unknown).call(self, ...args)
      );

      hook('configResolved', {}, { root, command: 'serve' });
      hook('configureServer', {}, server);
      await hook('buildStart', { environment: { name: 'client' } });
      await vi.waitFor(() => expect(collect).toHaveBeenCalledTimes(1));

      // What chokidar does the moment a server starts to close.
      if (closed) watcher.removeAllListeners();

      finish({ collection, dependencies: [], reached: [] });
      // Nothing is left past the collection but microtasks until a write
      // starts, which is then waited on.
      await new Promise((flushed) => { setTimeout(flushed, 0); });
      await Promise.all(vi.mocked(writeIfChanged).mock.results.map(({ value }) => value));

      const written = vi.mocked(writeIfChanged).mock.calls.map(([, contents]) => contents);

      expect(written).toEqual(closed ? [placeholder()] : [placeholder(), emit(collection.entries, 'en').contents]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Each generation is held until the test releases it; `bursts[n]` lands
  // while generation n runs, and `reads[n]` is what generation n reached.
  it.each([
    ['answers a burst of changes with one generation after the running one', [[['src/i18n.js', 10]]], [], 2],
    ['answers a change once the queued generation has started with one more', [[['src/i18n.js', 1]], [['src/i18n.js', 1]]], [], 3],
    ['answers a catalogue the running generation read before it changed with the queued one', [[['src/i18n.js', 1], ['src/en.json', 1]]], [['src/en.json']], 2],
  ] as [string, [string, number][][], string[][], number][])('%s', async (_, bursts, reads, generations) => {
    const root = await mkdtemp(resolve(tmpdir(), 'typegen-'));
    const gates: (() => void)[] = [];

    vi.mocked(collect).mockClear().mockImplementation(() => new Promise((done) => {
      const dependencies = (reads[gates.length] ?? []).map((path) => resolve(root, path).split(sep).join('/'));

      gates.push(() => done({ collection: { entries: [], referenceLocale: 'en', diagnostics: [], skipped: [] }, dependencies, reached: dependencies }));
    }));

    try {
      const plugin = typegen({ config: 'src/i18n.js', outFile: 'schema.d.ts' });
      const watcher = Object.assign(new EventEmitter(), { add: () => watcher });
      const server = {
        watcher,
        config: { experimental: {}, logger: { warn: () => {}, error: () => {} } },
        environments: { client: { pluginContainer: { buildStart: async () => {} } } },
      };
      const hook = (name: 'configResolved' | 'configureServer' | 'buildStart', self: unknown, ...args: unknown[]) => (
        (plugin[name] as (...rest: unknown[]) => unknown).call(self, ...args)
      );

      hook('configResolved', {}, { root, command: 'serve' });
      hook('configureServer', {}, server);
      await hook('buildStart', { environment: { name: 'client' } });

      for (const [index, burst] of bursts.entries()) {
        await vi.waitFor(() => expect(collect).toHaveBeenCalledTimes(index + 1));
        burst.forEach(([path, times]) => Array.from({ length: times }).forEach(() => watcher.emit('change', resolve(root, path))));
        gates[index]();
      }

      await vi.waitFor(() => expect(collect).toHaveBeenCalledTimes(generations));
      gates[generations - 1]();

      // A generation queued past the last one starts within a filesystem
      // round trip; none must.
      await expect(vi.waitFor(() => expect(collect).toHaveBeenCalledTimes(generations + 1), { timeout: 500 })).rejects.toThrow();
    } finally {
      vi.mocked(collect).mockReset();
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['a skipped loader\'s, without its stack', 'loader-skipped', () => 'Error: no slug'],
    ['an unchecked locale\'s, with its stack', 'locale-unchecked', (cause: Error) => cause.stack],
  ] as const)('reports the cause of a warning as a warning: %s', async (_name, code, logged) => {
    const root = await mkdtemp(resolve(tmpdir(), 'typegen-'));
    const cause = new Error('no slug');
    const diagnostics = [{ code, message: 'A warning.', cause }];
    const logger = { warn: vi.fn(), error: vi.fn() };

    vi.mocked(collect).mockClear().mockResolvedValueOnce({
      collection: { entries: [entry('late', 'late')], referenceLocale: 'en', diagnostics, skipped: [] },
      dependencies: [],
      reached: [],
    });

    try {
      const plugin = typegen({ config: 'src/i18n.js', outFile: 'schema.d.ts' });
      const watcher = Object.assign(new EventEmitter(), { add: () => watcher });
      const server = {
        watcher,
        config: { experimental: {}, logger },
        environments: { client: { pluginContainer: { buildStart: async () => {} } } },
      };
      const hook = (name: 'configResolved' | 'configureServer' | 'buildStart', self: unknown, ...args: unknown[]) => (
        (plugin[name] as (...rest: unknown[]) => unknown).call(self, ...args)
      );

      hook('configResolved', {}, { root, command: 'serve' });
      hook('configureServer', {}, server);
      await hook('buildStart', { environment: { name: 'client' } });
      await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledTimes(2));

      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenLastCalledWith(logged(cause));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
