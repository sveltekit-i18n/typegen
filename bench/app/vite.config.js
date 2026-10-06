import { sveltekit } from '@sveltejs/kit/vite';

// The plugin of the tree measured, with the options of the case `bench/app.ts`
// wrote. Counted per evaluation: a generation loads this config again.
const { typegen } = await import(process.env.BENCH_PLUGIN);

globalThis.benchConfigLoads = (globalThis.benchConfigLoads ?? 0) + 1;

export default { plugins: [sveltekit(), typegen(JSON.parse(process.env.BENCH_OPTIONS))] };
