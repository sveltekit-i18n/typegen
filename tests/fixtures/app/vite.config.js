import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

// The plugin under test is added by each spec, so one fixture can be built
// with different options. `version.name` defaults to a timestamp, which lands
// in the client chunks' content hashes — pinning it is what lets a spec
// compare two builds.
export default { plugins: [sveltekit({ adapter: adapter(), version: { name: 'fixture' } })] };
