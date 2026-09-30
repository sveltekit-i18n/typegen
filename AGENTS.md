# AGENTS.md

Behavioral guidelines for LLM coding assistants working on
**`@sveltekit-i18n/typegen`**. Applies to anything that drives commits, PRs, or
file edits on this repo.

**Precedence:** These repo rules override individual LLM memory or personal
preference. If your own memory conflicts with this file, follow this file.

This repo follows the same working rules as
[`base`'s AGENTS.md](https://github.com/sveltekit-i18n/base/blob/master/AGENTS.md)
(sections 1-14: think before coding, simplicity first, surgical changes,
verify and review cycle with release planning, commit on approval, fixup
hygiene, branch & push discipline, PRs, docs track code, coding conventions,
security posture, English-only artifacts, test rules, terse output, no
emojis). What follows is only what differs here.

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
flat config, Node 22+. The peer is `vite`; `sveltekit-i18n`,
`@sveltekit-i18n/base` and `@sveltejs/kit` are OPTIONAL peers — an app brings
one of the two cores, and a required peer on base would install a second copy
next to the one `sveltekit-i18n` depends on. The plugin works in a plain Vite
app, and Kit's plugins are simply picked up when the app has them.

The base range is `^3.0.0 || ^3.1.0-next.0`: `sveltekit-i18n` 3.0 pins base
3.0.0 exactly, so an app on it has no 3.1 core to offer. The loaders are read
through the core's own `resolveLoaders` when the app's copy has one (3.1), and
through a local copy of 3.0's reading otherwise; the collector imports the
core's `/utils` as a namespace so a 3.0 core still links. That copy sanitizes
each locale once, as 3.1 does: 3.0 sanitizes a requested locale a second time,
which only a `sanitizeLocales` that changes its own output tells apart, and
there it skips loaders the config states.

The suite runs on Node only. Unlike the runtime packages there are no Bun and
Deno legs: this never ships to a consumer's runtime. Windows IS in the matrix,
because the package resolves module ids and writes paths.

A release is planned with the rest of the family (base's §4, *Releases*):
after `base` and the parsers, before `sveltekit-i18n`, whose examples run it.
`README.md` is the npm page, so it describes the version being published, and
each of its links resolves.

Issues for this repo live in the `lib` tracker.

## Repository map

| Path | Role |
|------|------|
| `src/index.ts` | entry — the plugin and the public types |
| `src/plugin.ts` | the Vite plugin: when to generate, what to report, the dev watch set |
| `src/collect.ts` | the driver — resolves the app's config again and runs the collector in its server environment |
| `src/collector.ts` | the source of the virtual module the collection runs as |
| `src/derive.ts` | runs the loaders, reads the keys back and compares the other locales with the reference; a SEPARATE tsup entry |
| `src/emit.ts` | pure: `ParamSpec[]` and values in, `.d.ts` text out |
| `src/write.ts` | `writeIfChanged` |
| `src/types.ts` | public types and the diagnostic codes |
| `tests/specs/index.spec.ts` | `emit` and `derive`, in-process |
| `tests/specs/plugin.spec.ts` | real `vite build` and dev server over the fixture app |
| `tests/specs/typing.spec.ts` | compiles the emitted artifact against the published types |
| `tests/fixtures/run.js` | runs the SHIPPED plugin over a fixture, per case, in its own process |
| `tests/fixtures/app/` | a real SvelteKit app (adapter-node), several configs as several exports; it declares its dependencies, as the app's own server needs them declared to compile the core |
| `tests/fixtures/typing/` | `ok.ts` / `bad.ts` / `degrades.ts` / `skipped.ts` — deliberately broken TypeScript, excluded from `tsconfig` and from ESLint, typed by the cast on a 3.0 core; `registry/` holds the cases a 3.1 core types by the registration |

## Architecture you must respect

- **Keys come from EXECUTION, never from static analysis.** `config.preprocess`
  owns the shape of the keys that reach `translations` and a custom one is
  opaque, `key` prefixes a namespace at load time, and a loader is a function.
  A glob over the catalogues answers a different question. There is no
  type-level counterpart to reach for either — a second implementation of
  `preprocess` as a type would diverge silently, in the direction where the
  types claim a key the runtime does not have.
- **The collection runs in the app's own server environment.** The app's
  config is resolved again, for `serve` and with the build's inline options,
  mode and a cache of its own, and one runnable `ssr` environment is built
  from it — no server, so no watcher, no `configureServer` and nothing of
  Kit's dev handler. The config then resolves, pre-bundles and compiles
  exactly as the app's pages do under `vite dev`; never copy resolve options
  across by hand, as each copy misses a case the app handles (a pre-bundled
  core is compiled by the Svelte plugin, a runner without the optimizer runs
  it raw). The optimizer is started as a server's `listen()` would, and the
  pre-bundles land under `cacheDir/typegen`, so the app's own are never
  rewritten under a dev server it runs meanwhile.
- **The collector is one virtual module, under top-level await.** The
  environment is closed once the import returns, so a loader called afterwards
  throws — everything has to happen before the exports are read. That is also
  what makes the returned `dependencies` non-empty: lazy loaders never evaluate
  their catalogues otherwise, and the dev watch set would be empty. A run names
  what it evaluated (`dependencies`) and what its module graph holds
  (`reached`): the graph also holds what a reached module could import and
  never did, every file a dynamic import's glob matches, and it holds a module
  once it has loaded, before its transform can fail — a catalogue a loader
  could not transform is in it and not among what was evaluated. What lies in
  `node_modules` or the cache is left out of both; what lies outside the root,
  a linked workspace package, is not.
- **The nested config evaluates the plugin again, and it stays inert there.**
  The config is resolved for `serve`, so `buildStart` returns at once, and no
  server is created, so `configureServer` never runs. It logs through a silent
  logger of its own, never through `logLevel`: the Svelte plugin sets the level
  of a logger it shares with the app's, and the build's warnings would go
  quiet. The price is that the Svelte plugin's own messages about the nested
  config print at the app's level — in a SvelteKit app there are none, while
  a plain Svelte app without a `svelte.config.js` is told so, at `info`, on
  every generation. Closing the environment waits for every request still open, so it is
  given a few seconds, and a failure to close never hides why it failed to
  start.
- **A dev server generates once its own optimizers have loaded.** Vite clears
  the stale pre-bundling directories of the first cache a process loads, so
  the app's cache has to be that one. Vite loads them the moment the client's
  plugins have started, on `listen()` or, behind a framework's server, once
  the server is created. The plugin's own `buildStart` for the client is the
  signal: the start is then Vite's, so it is joined and never made, a start
  that failed is Vite's to report, and a server that never starts its client
  never generates. A bundled dev server starts the client through its bundler,
  after the optimizers. The server never waits for a generation. Its watcher is
  the one sign of whether it still serves: chokidar drops the listeners the
  moment `close()` starts, so a generation checks that the watcher still
  carries the plugin's own before it writes, reports or watches anything, and
  a closing server's watcher is never added to — that would open it again and
  keep the process alive. A restarted server has a successor writing the same
  file, so its own generation still in flight writes nothing. A plugin instance can
  outlive its server (a restart with inline plugins), so nothing of this is
  kept on the instance. A change that lands while a generation is queued or
  running is kept until the next generation to name its watch set, or read by
  one that starts after it: the generation may have read the file before it
  changed, and the first one has no watch set to match it against. Changes
  coalesce: at most one generation waits behind the running one, and a change
  the watcher reports before it starts joins it instead of queueing another,
  since it reads every file after that change. It stops waiting as it starts,
  before it reads anything, so a change reported while it runs queues the
  next. Only a generation without an error narrows the watch
  set, to what it evaluated; one that failed, a `loader-threw` included, adds
  everything it reached, and one that never reached the app
  leaves it alone, since a failed one may not have reached the file whose next
  change fixes it. The config is answered whatever the set holds, and so are an
  addition and a removal: a branch switch removes a file and brings it back.
  The watch set is named before the artifact is written, so a file outside the
  root is added to the watcher before anything announces the generation. All
  of it is answered only while Vite's watcher follows the file, and chokidar
  decides that: it starts a watch asynchronously, follows nothing of the root
  on a bundled dev server, and can lose a watch whose directory is removed.
  A missing path is never added to the watcher to cover a gap: chokidar
  watches it through its parent instead, and the server's own watch of a
  directory created later goes blind. The README's `vite dev` limit states
  the gaps as one rule, with the remedy (save the config, else restart);
  another watcher edge case belongs under that rule, not in more code.
- **A pre-bundled package is read back to its installed file.** The core is
  resolved from the package the config reached it through, and a bundle in the
  cache resolves from the app root instead; the optimizer's metadata maps it
  back, for the resolution and for the location a diagnostic names.
- **Build a FRESH `sveltekit()` only where the nested config lacks Kit, never
  reuse `resolved.plugins`.** Kit's plugins share one closure; re-running
  their `configResolved` for the nested config overwrites the config the outer
  build later reads, the adapter never runs, and the build still exits zero.
  A config file supplies its own; a programmatic build without one gets a
  fresh copy.
- **The probe is built from the core the config runs on.** The collector
  watches the config's imports resolve and asks for the core afterwards, from
  a virtual module: base as `sveltekit-i18n` resolves it when the config
  imports that, as the config resolves it when it imports base, and from the
  root, `sveltekit-i18n` first, when it imports neither. The app root need not
  resolve base at all (pnpm), and a stray root copy of another version must
  not type the app.
- **One build collects once.** SvelteKit builds its client inside the server
  build, from the config file loaded again, so a second instance of the plugin
  starts while the first build is open. The artifact being generated is held
  in a registry on `globalThis` (the module itself can load twice) from
  `buildStart` until the claiming build's `closeBundle` (ordered `pre`, so
  another plugin's failing one cannot skip it), its `buildEnd` with an error or
  its watcher's next change, so the next build — a watcher's round, a
  programmatic one — generates again.
- **`NODE_ENV` is the build's.** Vite states it before any hook runs and
  never overrides one that is set, so the nested config reads the build's:
  `dev` is `false` in a production build, as in the app's own server bundle.
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
  go in as inline `import('…')`. It holds `interface TranslationSchema` and,
  after it, a fixed block registering it —
  `declare namespace SvelteKitI18n { interface Register { schema: TranslationSchema } }`
  — which base and `sveltekit-i18n` 3.1 read for every config that states no
  `schema`, and which 3.0 ignores; the placeholder carries the same block. The
  interface keeps its global name, so the cast (`schema: {} as
  TranslationSchema`) still types a 3.0 core and still overrides per instance.
- **`emit` is pure and byte-stable.** Keys are sorted, so an unchanged
  catalogue produces unchanged bytes and `writeIfChanged` skips the write. That
  is not an optimization: the artifact lands inside the tree the dev server
  watches, and an unconditional write regenerates forever.
- **A failed generation is reported, never thrown.** The artifact is types; a
  build that cannot be typed still deploys. An error code keeps the previous
  artifact rather than writing a key set short of the real one. A write that
  fails is reported as one, never as a config that could not be read.
- **The extractor's output is read at the boundary.** It is the app's parser:
  a parameter list whose entry has no string `name`, or a `when` other than a
  list of string `param` and `branch` pairs, costs that key its payload as a
  throw would (`extractor-threw`). A `kind` the table lacks, a prototype name
  included, reads as `unknown`. A key, a name or a namespace is written with
  its line terminators escaped.
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
  compiles what `emit` wrote, block included, against a 3.0 core through the
  cast (`sveltekit-i18n-3.0`, an aliased `sveltekit-i18n@3.0.0` with its own
  base, which ignores the registration, so only the cast types those cases)
  and against the 3.1 cores through the registration.
- **`typing.spec.ts` runs `tsc` at `skipLibCheck: false`.** Two regression
  classes — an artifact that is a `type` alias, and a key a user redeclares
  differently — are invisible at the `skipLibCheck: true` every SvelteKit app
  inherits, and would break only for a stricter consumer.
- **Every case in `plugin.spec.ts` spawns its own process.** Kit's plugins keep
  module-level state, and the plugin's work happens inside a nested pipeline of
  exactly those plugins — two builds in one process would not be independent.
- The suite runs against base 3.1, which the fixture app resolves too. The 3.0
  path — no `resolveLoaders` in the core's `/utils` — is covered in process, by
  calling `derive` without it; the aliased 3.0 core serves `typing.spec.ts`'s
  cast cases only.
- Vitest sets `fileParallelism: false` and a two-minute timeout: a spec starts
  real Vite pipelines.
- Fixture apps and the typing subjects are excluded from `tsconfig.json` and
  from ESLint. Both are deliberate — one is an app with a config of its own, the
  other is TypeScript that is SUPPOSED to fail to compile.
