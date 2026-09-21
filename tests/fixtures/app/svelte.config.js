import adapter from '@sveltejs/adapter-node';

// `version.name` defaults to a timestamp, which lands in the client chunks'
// content hashes — pinning it is what lets a spec compare two builds.
export default {
  kit: { adapter: adapter(), version: { name: 'fixture' } },
};
