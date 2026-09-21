import { build, createServer } from 'vite';

import typegen from '../../dist/index.js';

// Runs the SHIPPED plugin over a fixture app, in a process of its own.
//
// SvelteKit's Vite plugins keep module-level state, so two builds in one
// process are not independent — and the plugin's whole job happens inside a
// nested pipeline of exactly those plugins. A spec therefore spawns this
// script per case and reads the result off the filesystem and this output.
const { mode, root, ...options } = JSON.parse(process.argv[2]);

// SvelteKit reads `svelte.config.js` and the app template off the working
// directory rather than off Vite's root, so the app has to be entered the way
// its own scripts enter it.
process.chdir(root);

const plugins = [typegen(options)];

if (mode === 'serve') {
  const server = await createServer({ root, plugins, logLevel: 'warn', server: { middlewareMode: true } });

  process.on('SIGTERM', () => void server.close().then(() => process.exit(0)));

  console.log('ready');
} else {
  await build({ root, plugins, logLevel: 'warn' });
}
