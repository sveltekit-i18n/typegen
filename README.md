[![npm version](https://badge.fury.io/js/@sveltekit-i18n%2Ftypegen.svg)](https://badge.fury.io/js/@sveltekit-i18n%2Ftypegen) ![](https://github.com/sveltekit-i18n/typegen/workflows/Tests/badge.svg)

# @sveltekit-i18n/typegen

Fills [`config.schema`](https://github.com/sveltekit-i18n/base#schema) for you. A Vite plugin that reads your app's own translations and writes the `TranslationSchema` type that [sveltekit-i18n](https://github.com/sveltekit-i18n/lib) and [`@sveltekit-i18n/base`](https://github.com/sveltekit-i18n/base) use to type `t` and `l` — keys autocomplete, an unknown key is a type error, and each message's payload is checked against what its own text asks for.

It runs on `vite build` and regenerates while `vite dev` is running. There is no CLI step to remember.

## How it derives the keys

**By running your config, not by globbing your files.** `config.preprocess` decides the shape of the keys that reach `translations`, a `key` prefixes a namespace at load time, and a loader is ordinary JavaScript — one that imports a template literal names no file anything static could read. So the plugin evaluates the config module inside your app's own Vite pipeline (`$lib`, `$env` and every alias resolve), calls the loaders, and reads the keys back off the core your app would have built.

Payloads come from the other half: the parser's build-time `extractParams`, which reports what a given message text accepts.

## Requirements

Vite 8 or newer, and Node 22+. SvelteKit is optional — its plugins are picked up when the app has them, which is what makes `$lib`, `$env` and `$app/environment` resolve.

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
    { locale: 'en', key: 'home', routes: ['/'], loader: async () => (await import('./en/home.json')).default },
    { locale: 'cs', key: 'home', routes: ['/'], loader: async () => (await import('./cs/home.json')).default },
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

The locale whose catalogue defines the key set. Defaults to the config's `initLocale`, then its `fallbackLocale`, then the first locale it names. One catalogue is the source of truth; the others are not unioned in.

### `outFile`

Where to write, relative to the Vite root. Defaults to `src/i18n-schema.d.ts`. It has to sit under `src/` — that is the only place SvelteKit's generated `tsconfig.json` picks a `.d.ts` up without the app being edited, and `.svelte-kit` is wiped by `svelte-kit sync`.

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
| `config-unreadable` | the config module could not be imported | nothing is written |
| `config-export-missing` | the module carries no such export | nothing is written |
| `reference-locale-missing` | the config names no locale to derive from | nothing is written |
| `loader-threw` | a loader failed, so its keys are missing | nothing is written |
| `no-keys` | the reference locale's catalogue came back empty | nothing is written |
| `extractor-unreadable` | `extractParams` did not resolve to a factory | keys only, payloads `any` |
| `extractor-threw` | one message could not be read | that key's payload is `any` |

A loader that never settles is treated as one that threw, after thirty seconds. The core swallows a throwing loader to keep a page rendering; this package does not, because a key set silently short of the real one makes the types lie.

## Limits

- **One reference locale.** Keys present only in another locale are not in the schema, and no diagnostic reports them.
- **Route scoping is bypassed.** Every loader runs, so the schema covers every route, and each is handed its own first `routes` entry (or `/` when the entry is a pattern). A loader that derives its *keys* from the route it is given cannot be typed by any single choice.
- **A grouping-dependent `preprocess` is out of contract.** The loaders are applied in one batch, as a single visit to every route would have produced. A custom `preprocess` that looks only at the leaf it is handed sees exactly what your app hands it; one whose output depends on the sibling namespaces in the same batch is decided by how the batch was grouped, and no grouping reproduces every route an app can take.
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
