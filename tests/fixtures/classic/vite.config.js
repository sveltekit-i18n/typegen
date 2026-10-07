import { sveltekit } from '@sveltejs/kit/vite';

// The form SvelteKit 2 has always read, and the only one before 2.62: its
// options in `svelte.config.js`, `sveltekit()` called without any.
export default { plugins: [sveltekit()] };
