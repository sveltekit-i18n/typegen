import { sveltekit } from '@sveltejs/kit/vite';

// The plugin under test is added by each spec, so one fixture can be built
// with different options.
export default { plugins: [sveltekit()] };
