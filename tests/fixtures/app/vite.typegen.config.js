import { sveltekit } from '@sveltejs/kit/vite';

import typegen from '../../../dist/index.js';

// The plugin where an app puts it: in the config file, which SvelteKit loads a
// second time for its client build.
export default { plugins: [sveltekit(), typegen(JSON.parse(process.env.TYPEGEN_OPTIONS))] };
