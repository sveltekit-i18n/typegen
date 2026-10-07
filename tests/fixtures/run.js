import { resolve } from 'node:path';

import { createBuilder, createServer } from 'vite';

import typegen from '../../dist/index.js';

// Runs the SHIPPED plugin over a fixture app, in a process of its own.
//
// SvelteKit's Vite plugins keep module-level state, so two builds in one
// process are not independent — and the plugin's whole job happens inside a
// nested pipeline of exactly those plugins. A spec therefore spawns this
// script per case and reads the result off the filesystem and this output.
const { mode, root, configFile, inlineKit = false, vite = {}, listen = false, restart = false, close = false, neighbours: named = [], ...options } = JSON.parse(process.argv[2]);

// SvelteKit 2 reads `svelte.config.js` and the app template off the working
// directory rather than off Vite's root, so the app has to be entered the way
// its own scripts enter it.
process.chdir(root);

// Vitest hands its own `NODE_ENV` down; a build run from a shell has none, and
// Vite then states the one the command implies.
delete process.env.NODE_ENV;

// A config file carries the plugin itself, as an app's does; it reads the
// options off the environment.
process.env.TYPEGEN_OPTIONS = JSON.stringify(options);

// A plugin after this one, as an app's own server setup has them.
const neighbours = {
  // One whose server setup awaits real work, as an adapter's emulation does.
  slow: { name: 'slow', configureServer: () => new Promise((done) => { setTimeout(done, 300); }) },
  // One that fails to start.
  failing: { name: 'failing', buildStart() { if (this.environment.name === 'client') throw new Error('Failed to start.'); } },
  // One whose server setup fails once the other hooks have returned.
  failingLate: { name: 'failing-late', configureServer: () => () => { throw new Error('Failed to set up.'); } },
  // One that takes its time to close, as an adapter's emulation can.
  slowClose: { name: 'slow-close', buildEnd() { if (this.environment?.name === 'client') return new Promise((done) => { setTimeout(done, 5_000); }); } },
  // One that tells whenever the client's plugins start.
  counted: { name: 'counted', buildStart() { if (this.environment?.name === 'client') console.log('client started'); } },
};

// A programmatic build that reads no config file and passes SvelteKit inline,
// with its options or, as `'bare'`, without any, which SvelteKit 2 then reads
// from `svelte.config.js`. Imported once the app is entered: SvelteKit 2 reads
// the working directory as its module loads.
const inlined = async () => {
  const [{ default: adapter }, { sveltekit }] = await Promise.all([import('@sveltejs/adapter-node'), import('@sveltejs/kit/vite')]);

  return inlineKit === 'bare' ? sveltekit() : sveltekit({ adapter: adapter(), version: { name: 'fixture' } });
};

const kit = inlineKit ? [await inlined()] : [];

const plugins = configFile ? [] : [...kit, typegen(options), ...named.map((name) => neighbours[name])];

const file = inlineKit ? { configFile: false } : configFile ? { configFile: resolve(root, configFile) } : {};

if (mode === 'serve') {
  // Behind a framework's own server by default; `listen` starts Vite's.
  const server = await createServer({ ...vite, root, plugins, logLevel: 'warn', server: { middlewareMode: !listen } }).catch((error) => {
    // A framework that handles its server failing to start keeps running.
    console.log(`caught: ${error.message}`);
  });

  if (!server) {
    // An unhandled rejection would have ended the process by the next task.
    await new Promise((next) => { setTimeout(next, 0); });
    console.log('survived');
    process.exit(0);
  }

  if (listen) await server.listen(0);

  // What a changed `.env` or the `r` shortcut does, with the same plugins.
  if (restart) await server.restart();

  // A server closed at once leaves nothing behind to keep the process alive.
  if (close) {
    await server.close();
    console.log('closed');
  }

  process.on('SIGTERM', () => void server.close().then(() => process.exit(0)));

  console.log('ready');
} else {
  const { fetch } = globalThis;

  // What `vite build` runs: SvelteKit 3 builds its environments from the
  // builder's `buildApp`, which `build()` never calls.
  const builder = await createBuilder({ ...vite, root, plugins, logLevel: 'warn', ...file }, null);

  await builder.buildApp();

  // Nothing of the collection is left behind in the process that built.
  if (globalThis.fetch !== fetch) console.log('fetch was replaced');
}
