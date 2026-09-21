# AGENTS.md

Behavioral guidelines for LLM coding assistants working on
**`@sveltekit-i18n/typegen`**. Applies to anything that drives commits, PRs, or
file edits on this repo.

**Precedence:** These repo rules override individual LLM memory or personal
preference. If your own memory conflicts with this file, follow this file.

This repo follows the same working rules as
[`base`'s AGENTS.md](https://github.com/sveltekit-i18n/base/blob/master/AGENTS.md)
(sections 1-14: think before coding, simplicity first, surgical changes,
verify before committing, commit on approval, fixup hygiene, branch & push
discipline, PRs, docs track code, coding conventions, security posture,
English-only artifacts, test rules, terse output, no emojis). What follows is
only what differs here.

---

## The package

The build-time half of v3's typed translations. `base` ships the `config.schema`
slot ([lib#221](https://github.com/sveltekit-i18n/lib/issues/221)) and the
parsers ship the `extractParams` contract
([lib#227](https://github.com/sveltekit-i18n/lib/issues/227)); this package is
what fills the slot, as
[lib#234](https://github.com/sveltekit-i18n/lib/issues/234) set out. It is
build-time tooling, so it is deliberately NOT in `base` — the core keeps its
zero runtime dependencies and this repo keeps its own release cadence.

Stack: npm with `package-lock.json`, TypeScript ESM, tsup, Vitest, ESLint 10
flat config, Node 22+. Peers are `vite` and `@sveltekit-i18n/base`;
`@sveltejs/kit` is an OPTIONAL peer — the plugin works in a plain Vite app, and
Kit's plugins are simply picked up when the app has them.

The suite runs on Node only. Unlike the runtime packages there are no Bun and
Deno legs: this never ships to a consumer's runtime. Windows IS in the matrix,
because the package resolves module ids and writes paths.

Issues for this repo live in the `lib` tracker.

## Repository map

| Path | Role |
|------|------|
| `src/index.ts` | entry — the plugin and the public types |
| `src/plugin.ts` | the Vite plugin: when to generate, what to report, the dev watch set |
| `src/collect.ts` | the `runnerImport` driver — builds the nested pipeline and pins its environment |
| `src/collector.ts` | the source of the virtual module the collection runs as |
| `src/derive.ts` | runs the loaders and reads the keys back; a SEPARATE tsup entry |
| `src/emit.ts` | pure: `ParamSpec[]` and values in, `.d.ts` text out |
| `src/write.ts` | `writeIfChanged` |
| `src/types.ts` | public types and the diagnostic codes |
| `tests/specs/index.spec.ts` | `emit` and `derive`, in-process |
| `tests/specs/plugin.spec.ts` | real `vite build` and dev server over the fixture app |
| `tests/specs/typing.spec.ts` | compiles the emitted artifact against the published types |
| `tests/fixtures/run.js` | runs the SHIPPED plugin over a fixture, per case, in its own process |
| `tests/fixtures/app/` | a real SvelteKit app (adapter-node), several configs as several exports |
| `tests/fixtures/typing/` | `ok.ts` / `bad.ts` / `degrades.ts` — deliberately broken TypeScript, excluded from `tsconfig` and from ESLint |

## Architecture you must respect

- **Keys come from EXECUTION, never from static analysis.** `config.preprocess`
  owns the shape of the keys that reach `translations` and a custom one is
  opaque, `key` prefixes a namespace at load time, and a loader is a function.
  A glob over the catalogues answers a different question. There is no
  type-level counterpart to reach for either — a second implementation of
  `preprocess` as a type would diverge silently, in the direction where the
  types claim a key the runtime does not have.
- **The collection is one `runnerImport` of a virtual module, under top-level
  await.** The runner is closed the moment `runnerImport` returns, so a loader
  called afterwards throws — everything has to happen before the exports are
  read. That is also what makes the returned `dependencies` non-empty: lazy
  loaders never evaluate their catalogues otherwise, and the dev watch set
  would be empty.
- **Build a FRESH `sveltekit()`, never reuse `resolved.plugins`.** Kit's
  plugins share one closure; re-running their `configResolved` inside a nested
  environment overwrites the config the outer build later reads, the adapter
  never runs, and the build still exits zero.
- **The core is inlined (`resolve.noExternal`), and so is `esm-env`.** base
  ships its rune modules uncompiled for the consumer's bundler, so externalized
  it reaches the host runtime with `$state` undefined. Externalized `esm-env`
  makes `$app/environment.dev` `undefined` rather than a boolean, which a config
  branching on it reads as production by accident.
- **`NODE_ENV` is stated for the call and put back.** `runnerImport` always
  resolves as `serve`, so a config branching on `dev` would hand a production
  build the development key set — and `runnerImport` rewrites the host's
  `NODE_ENV` on the way through, which the app's own build would otherwise
  inherit.
- **Never derive through `loadTranslations`.** `fetchTranslations` swallows a
  throwing loader by contract, which would turn one broken loader into a
  silently truncated schema. The loaders are called here, each against a
  deadline, and a failure is a diagnostic.
- **The placeholder is an EMPTY interface, and it is written first.** It is
  written before anything that can throw, so a failed generation leaves a
  project that still compiles. It must never become an index signature or a
  `type` alias: an index signature survives the declaration merge and makes
  `Schema.HasClosedKeys` `false` FOREVER — a perfect artifact, no diagnostic,
  and nothing narrows. A `type` alias is a duplicate identifier that
  `skipLibCheck: true` hides.
- **The artifact is a global script `.d.ts`: no top-level `import` or
  `export`, ever.** One turns it into a module and the global vanishes, with an
  error that points at the consumer rather than at the artifact. External types
  go in as inline `import('…')`.
- **`emit` is pure and byte-stable.** Keys are sorted, so an unchanged
  catalogue produces unchanged bytes and `writeIfChanged` skips the write. That
  is not an optimization: the artifact lands inside the tree the dev server
  watches, and an unconditional write regenerates forever.
- **A failed generation is reported, never thrown.** The artifact is types; a
  build that cannot be typed still deploys. An error code keeps the previous
  artifact rather than writing a key set short of the real one.
- **Keys-only mode emits `any`, not `never`.** `never` is how the core spells a
  message that takes NO payload, so it rejects every legal call that passes one.
- **`ParamSpec.values` never closes a union.** The contract calls it a hint;
  both official parsers fall back to a default branch. `when` is read as a doc
  comment and never discriminated — an open fallback makes a discriminated
  payload provably equivalent to the flat one, and a closed one rejects a
  selector computed at runtime.

## Tests

- Three specs, three jobs: `index.spec.ts` drives the pure halves in process,
  `plugin.spec.ts` drives real builds and a real dev server, `typing.spec.ts`
  compiles what `emit` wrote against the published `sveltekit-i18n` types.
- **`typing.spec.ts` runs `tsc` at `skipLibCheck: false`.** Two regression
  classes — an artifact that is a `type` alias, and a key a user redeclares
  differently — are invisible at the `skipLibCheck: true` every SvelteKit app
  inherits, and would break only for a stricter consumer.
- **Every case in `plugin.spec.ts` spawns its own process.** Kit's plugins keep
  module-level state, and the plugin's work happens inside a nested pipeline of
  exactly those plugins — two builds in one process would not be independent.
- Vitest sets `fileParallelism: false` and a two-minute timeout: a spec starts
  real Vite pipelines.
- Fixture apps and the typing subjects are excluded from `tsconfig.json` and
  from ESLint. Both are deliberate — one is an app with a config of its own, the
  other is TypeScript that is SUPPOSED to fail to compile.
