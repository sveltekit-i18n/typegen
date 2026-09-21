import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/specs/**/*.spec.ts'],
    // A spec starts real Vite servers over the fixture apps, which is far
    // slower than a unit test and must not be raced against its siblings.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
