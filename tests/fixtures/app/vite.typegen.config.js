import { sveltekit } from '@sveltejs/kit/vite';

import typegen from '../../../dist/index.js';

const served = (id, code) => ({
  name: id,
  resolveId: (source) => (source === id ? `\0${id}` : undefined),
  load: (source) => (source === `\0${id}` ? code() : undefined),
});

// Plugins of the app's own, each one a spec names in `TYPEGEN_FIXTURE`.
const fixtures = {
  // A module only a plugin of the app serves.
  served: served('virtual:greeting', () => "export default { title: 'Served' };"),
  // A module whose loading never settles, as a fetch without a timeout.
  never: served('virtual:never', () => new Promise(() => {})),
  // A plugin that refuses to start under `vite dev`.
  refuse: { name: 'refuse', apply: 'serve', options: () => { throw new Error('Refused while serving.'); } },
};

// The plugin where an app puts it: in the config file, which SvelteKit loads a
// second time for its client build.
export default {
  plugins: [
    sveltekit(),
    ...(process.env.TYPEGEN_FIXTURE ? [fixtures[process.env.TYPEGEN_FIXTURE]] : []),
    typegen(JSON.parse(process.env.TYPEGEN_OPTIONS)),
  ],
};
