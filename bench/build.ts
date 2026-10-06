import { readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { resolveConfig } from 'vite';
import type { Plugin, Rollup } from 'vite';

import { APP, configLoads, writeCase } from './app.ts';
import { within } from './collect.ts';

// 1,000 keys only: a generation applies the catalogue through the installed
// core, whose cost grows with the keys it holds.
export const KEYS = 1_000;

/**
 * The generation of a build, in a process of its own: the plugin's own
 * `buildStart`, on the config the build resolved. `cold` empties the cache of
 * pre-bundles a generation keeps, as on a fresh clone; otherwise it finds what
 * the last one left, as every later build does. Returns its duration and the
 * configs it loaded.
 */
export const generation = async (cold: boolean) => {
  const { outFile } = writeCase(KEYS, 'namespaces');
  const resolved = await resolveConfig({ root: APP, logLevel: 'silent' }, 'build');
  const { buildStart } = resolved.plugins.find(({ name }) => name === 'sveltekit-i18n-typegen') as Plugin;

  if (typeof buildStart !== 'function') throw new Error('The plugin generates in a hook of another shape.');

  // A generation that reports anything measures something other than one that
  // succeeds.
  const context = {
    environment: { name: 'ssr' },
    warn: (message: string) => { throw new Error(message); },
  } as unknown as Rollup.PluginContext;

  if (cold) rmSync(join(resolved.cacheDir, 'typegen'), { recursive: true, force: true });

  const loads = configLoads();
  const start = performance.now();

  await within(120, 'A generation', Promise.resolve(buildStart.call(context, {} as Rollup.NormalizedInputOptions)));

  const duration = performance.now() - start;

  if (!readFileSync(resolve(APP, outFile), 'utf8').includes('ns0.k1')) throw new Error('The generation wrote no artifact.');

  return { duration, loads: configLoads() - loads };
};
