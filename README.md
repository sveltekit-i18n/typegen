[![npm version](https://badge.fury.io/js/@sveltekit-i18n%2Ftypegen.svg)](https://badge.fury.io/js/@sveltekit-i18n%2Ftypegen) ![](https://github.com/sveltekit-i18n/typegen/workflows/Tests/badge.svg)

# @sveltekit-i18n/typegen

Fills [`config.schema`](https://github.com/sveltekit-i18n/base#schema) for you. A Vite plugin that reads your app's own translations and writes the `TranslationSchema` type that [sveltekit-i18n](https://github.com/sveltekit-i18n/lib) and [`@sveltekit-i18n/base`](https://github.com/sveltekit-i18n/base) use to type `t` and `l` — keys autocomplete, an unknown key is a type error, and each message's payload is checked against what its own text asks for.

It runs on `vite build` and regenerates while `vite dev` is running. There is no CLI step to remember.

## How it derives the keys

**By running your config, not by globbing your files.** `config.preprocess` decides the shape of the keys that reach `translations`, a `namespace` prefixes its data at load time, and a loader is ordinary JavaScript — one that imports a template literal names no file anything static could read. So the plugin evaluates the config module in your app's own server environment, the one `vite dev` renders pages with (`$lib`, `$env`, every alias, your plugins, `--mode` and your `ssr` options apply), calls the loaders, and reads the keys back off the core your app would have built. A config that `vite dev` can run, the plugin can read, with nothing to configure.

Payloads come from the other half: the parser's build-time `extractParams`, which reports what a given message text accepts.

## Requirements

`sveltekit-i18n` or `@sveltekit-i18n/base` 3.0 or newer (3.0 names a loader's namespace `key`; `namespace`, and a loader that lists several locales or namespaces, need 3.1), Vite 8 or newer, and Node 22+. The keys are read off the copy of the core your config runs on: the one `sveltekit-i18n` brings when the config imports that, the one it imports otherwise. SvelteKit is optional — its plugins are picked up when the app has them, which is what makes `$lib`, `$env` and `$app/environment` resolve.

## Installation

```bash
npm install -D @sveltekit-i18n/typegen
```

## Quick start

### 1. Export the config, not only the instance

```javascript
// src/lib/i18n.js
import I18n from 'sveltekit-i18n';

export const config = {
  initLocale: 'en',
  loaders: [
    { locale: 'en', namespace: 'home', routes: ['/'], loader: async () => (await import('./en/home.json')).default },
    { locale: 'cs', namespace: 'home', routes: ['/'], loader: async () => (await import('./cs/home.json')).default },
  ],
};

export default new I18n(config);
```

### 2. Add the plugin

```javascript
// vite.config.js
import { sveltekit } from '@sveltejs/kit/vite';
import { typegen } from '@sveltekit-i18n/typegen';

export default {
  plugins: [
    sveltekit(),
    typegen({
      config: 'src/lib/i18n.js',
      extractParams: { from: 'sveltekit-i18n' },
    }),
  ],
};
```

### 3. Point the schema slot at it

`TranslationSchema` is a global — the generated file declares it and imports nothing, so nothing has to import it either.

```typescript
const i18n = new I18n({ ...config, schema: {} as TranslationSchema });
```

In a JavaScript app, the same cast is a JSDoc one:

```javascript
const i18n = new I18n({ ...config, schema: /** @type {TranslationSchema} */ ({}) });
```

### 4. Ignore the output

```gitignore
src/i18n-schema.d.ts
```

It is reproducible from your translation files, so committing it only buys merge conflicts. A fresh clone has no schema until the first `vite dev` or `vite build`; until then `t()` takes plain strings, exactly as an app with no schema does.

## Options

### `config` (required)

The module holding the config object, relative to the Vite root. An alias works too (`$lib/i18n.js`).

### `configExport`

The export carrying the config. Defaults to `config`.

### `extractParams`

Where to find the parser's build-time extractor. Without it the keys still narrow and the payload slot stays unchecked — a strictly additive upgrade, so adding it later never invalidates code that compiled without it.

```javascript
// sveltekit-i18n re-exports the curly extractor, so the package name is enough
typegen({ config: 'src/lib/i18n.js', extractParams: { from: 'sveltekit-i18n' } })

// base + a parser of your own: name the parser, and the options you built it with
typegen({
  config: 'src/lib/i18n.js',
  extractParams: { from: '@sveltekit-i18n/parser-icu', options: { ignoreTag: true } },
})
```

`options` are the parser's own, and they are not optional in practice: a custom modifier, a changed delimiter or a disabled tag syntax changes which parameters a message has, so an extractor built with different options reports a different — wrong — set. A built parser object carries no way to recover them, which is why they are stated here.

`name` overrides the export the factory is read from (`extractParamsFactory`).

### `referenceLocale`

The locale whose catalogue defines the key set. Defaults to the config's `initLocale`, then its `fallbackLocale`, then the first locale it names. One catalogue is the source of truth; the others are not unioned in, but compared with it (see [`checkLocales`](#checklocales)).

### `outFile`

Where to write, relative to the Vite root. Defaults to `src/i18n-schema.d.ts`. It has to sit under `src/` — that is the only place SvelteKit's generated `tsconfig.json` picks a `.d.ts` up without the app being edited, and `.svelte-kit` is wiped by `svelte-kit sync`.

### `checkLocales`

Whether the other locales' loaders run too, so their keys can be compared with the reference locale's. Defaults to `true`. What the comparison finds is a warning — `key-missing`, `key-extra` or `locale-unchecked` below — and the schema is written all the same.

Turn it off when each locale costs a request of its own (a remote loader is then called once per build instead of once per locale), or when a locale is kept partial on purpose behind `fallbackLocale`. Only the reference locale's catalogues are then watched in `vite dev`.

### `enabled`

Turns generation off without removing the plugin. Defaults to `true`.

## What it writes

```typescript
// Generated by @sveltekit-i18n/typegen. Do not edit, and do not commit.
// Reference locale: en

interface TranslationSchema {
  /** First */
  'home.bullets.0': never;
  /** {{gender; male: He; female: She; default: They}} left */
  'home.choice': {
    gender?: unknown;
  };
  /** {{count:number}} items */
  'home.count': {
    count: number;
  };
  /** Hello, {{name}}! */
  'home.greeting': {
    name: unknown;
  };
}
```

`never` is how the core spells a message that takes no payload. A key whose message the extractor could not read is typed `any`, so it narrows the key and leaves the payload alone. The reference text rides along as a doc comment, which is what a completion popup shows.

The same file also carries the placeholder — an empty `interface TranslationSchema {}` — written before anything that can fail. An empty interface is not a schema as far as the core is concerned, so keys degrade to plain `string` and the project compiles; it also merges cleanly when the real artifact arrives, and with any key you declare yourself in a `.d.ts` of your own.

## Diagnostics

A failed generation is reported, never thrown: the artifact is types, and a build that cannot be typed still deploys. The previous artifact stands, so a schema is never replaced by one that is quietly short of the real key set.

| Code | Meaning | Effect |
|------|---------|--------|
| `config-unreadable` | the config could not be read: its module failed to import, or `preprocess` threw on a `config.translations` seed or on the reference locale's catalogue | nothing is written |
| `config-export-missing` | the module carries no such export | nothing is written |
| `core-too-old` | a loader names a `namespace` or an array of locales, which the 3.0 core the config runs on does not read (the message says where that core was found) | nothing is written |
| `reference-locale-missing` | the config names no locale to derive from | nothing is written |
| `loader-threw` | a loader failed, so its keys are missing | nothing is written |
| `loader-skipped` | a loader cannot run outside the app: it threw SvelteKit's request-store error (a remote `query` outside a request), or its `routes` capture params it was not given | warning, the schema is written with that namespace open (see [Limits](#limits)) and the namespace left out of the comparison |
| `no-keys` | the reference locale's catalogue came back empty | nothing is written |
| `extractor-unreadable` | `extractParams` did not resolve to a factory | keys only, payloads `any` |
| `extractor-threw` | one message could not be read | that key's payload is `any` |
| `key-missing` | another locale lacks keys the reference has (the message says how many of them render from `fallbackLocale`) | warning, the schema is written |
| `key-extra` | another locale has keys the reference lacks, so no type names them | warning, the schema is written |
| `locale-unchecked` | another locale's loader failed, or its catalogue could not be applied (its `preprocess` threw), so that locale was not compared | warning, the schema is written |

A loader that never settles is treated as one that threw, after thirty seconds; every locale's loaders run at once, so a generation waits that long at most, and a few seconds more for the requests such a loader left open. A message names the first ten keys it is about. The core swallows a throwing loader to keep a page rendering; this package does not, because a key set silently short of the real one makes the types lie.

## Limits

- **One reference locale.** Keys present only in another locale are not in the schema; `key-extra` reports them.
- **The comparison reads the keys the core holds**, after `preprocess`. Under the default `'full'` an array is one key per item, so an array of another length is reported; under `'preserveArrays'` or `'none'` the comparison is coarser. A locale only seeded through `config.translations` is not compared: seeds are often the same table in every locale.
- **A `sanitizeLocales` that changes its own output is typed as 3.1 loads it.** A 3.0 core sanitizes a requested locale twice and a loader's once, so under such a transform it skips loaders the config states; the schema still names their keys.
- **A namespace whose loader cannot run outside the app is open.** A loader backed by a remote `query`, or one whose `routes` capture params, has nothing to load at build time; its namespace is typed as any key under it (``[key: `post.${string}`]: any``, or `'post': any` under `preprocess: 'none'`), and every other key still narrows. Its keys do not autocomplete, its payloads are not checked, and a key union that spans one of them takes any payload. On a 3.1 core, a loader whose `routes` capture params is skipped whatever it throws, since a build has no params to hand it; a 3.0 core hands a loader no params at all. Under a custom `preprocess` no key shape can be guessed, so such a loader fails the generation as `loader-threw`, as any other throw does.
- **Route scoping is bypassed.** Every loader runs, so the schema covers every route, and each is handed its own first `routes` entry (or `/` when the entry is a pattern) and empty `params`. A loader that derives its *keys* from the route it is given cannot be typed by any single choice.
- **A grouping-dependent `preprocess` is out of contract.** The loaders are applied in one batch, as a single visit to every route would have produced. A custom `preprocess` that looks only at the leaf it is handed sees exactly what your app hands it; one whose output depends on the sibling namespaces in the same batch is decided by how the batch was grouped, and no grouping reproduces every route an app can take.
- **The config is evaluated as `vite dev` would, during a build too.** A config file that refuses to load outside a build, or a config module that throws under `vite dev`, is reported as `config-unreadable`; the build still succeeds and the previous schema stands. Plugins passed only inline to a programmatic `build()` are not applied to the evaluation — the ones in your config file are, and SvelteKit's always is.
- **`vite dev` regenerates on a change to the config or to a file a generation reached, and only while Vite's watcher follows that file.** It follows what lies under the root, from the start, on a default dev server. A file outside the root (a linked workspace package) is followed once a generation names it, and so is every file on a bundled dev server (Vite's `experimental.bundledDev`), whose watcher leaves the root to its bundler; there a watch can also be lost to a branch switch that removes a directory and brings it back. A file no generation reached yet (a catalogue created after a loader failed to find it, a config missing when the dev server starts that does not lie under the root on a default dev server, or one named by an alias such as `$lib/i18n.js`) is not followed either. When the schema lags, save the config; when that does not help, restart the dev server.
- **JavaScript apps need `// @ts-check`** (or `checkJs`) for `tsc` to report anything — SvelteKit's generated config allows JavaScript without checking it.

## Related packages

- [sveltekit-i18n](https://github.com/sveltekit-i18n/lib) – Complete solution, with the Curly Message Format parser included
- [@sveltekit-i18n/base](https://github.com/sveltekit-i18n/base) – The core this types
- [Parsers](https://github.com/sveltekit-i18n/parsers) – Curly, ICU, MessageFormat 2 and i18next, each shipping the extractor this reads
- [Extensions](https://github.com/sveltekit-i18n/extensions) – Official extensions for the `config.extensions` pipe

## Contributing

For general contribution guidelines, see the [Contributing Guide](https://github.com/sveltekit-i18n/lib/blob/master/CONTRIBUTING.md) in the main library repository.

Issues live in the [shared tracker](https://github.com/sveltekit-i18n/lib/issues).

## Changelog

See [Releases](https://github.com/sveltekit-i18n/typegen/releases) for version history.

## Sponsor

You can support the maintenance of this package through
[GitHub Sponsors](https://github.com/sponsors/sveltekit-i18n).

## License

MIT
