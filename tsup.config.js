import { defineConfig } from 'tsup';

export default defineConfig(
  /** @type {() => import('tsup').Options} */
  (options) => ({
    clean: true,
    dts: true,
    format: ['esm'],
    // `derive` is a second entry because the collector imports it by path:
    // it runs inside the app's module graph, where this package is not
    // resolvable by name, so it needs a file that is actually there.
    entry: ['src/index.ts', 'src/derive.ts'],
    minify: !options.watch,
    sourcemap: options.watch,
    splitting: true,
  }),
);
