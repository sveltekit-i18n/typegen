import { readFileSync, watch, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';
import { createLogger, createServer } from 'vite';

import { APP, writeCase } from './app.ts';
import { KEYS } from './build.ts';
import { record, within } from './collect.ts';
import { median } from './compare.ts';
import { of } from './data.ts';

// A dev server behind a framework's own, as SvelteKit's runs, regenerating
// after each change of a catalogue: what a change costs before the editor
// sees its keys, and what each one leaves behind.

// The first two changes warm up; the rest are read.
const WARMUPS = 2;
const CHANGES = 10;

const { catalogues, outFile } = writeCase(KEYS, 'namespaces');
const artifact = resolve(APP, outFile);
const data = catalogues.map((catalogue) => JSON.parse(readFileSync(catalogue, 'utf8')) as Record<string, string>);

const read = () => {
  try {
    return readFileSync(artifact, 'utf8');
  } catch {
    return '';
  }
};

// What the plugin reports fails the project, with the cause it logs on the
// lines right after; the server's own messages stay silent.
let report!: (message: string) => void;

const reported = new Promise<never>((_, reject) => {
  let lines: string[] | undefined;

  report = (message) => {
    if (lines) lines.push(message);
    else if (message.includes('[sveltekit-i18n-typegen]')) {
      lines = [message];
      queueMicrotask(() => reject(new Error(lines!.join('\n'))));
    }
  };
});

reported.catch(() => {});

const customLogger = { ...createLogger('silent'), warn: report, warnOnce: report, error: report };

/**
 * Resolves once the artifact holds `key` of the first namespace. A write of it
 * is seen in parts, so what tells is a whole file, one TypeScript parses, that
 * names the key as `ns0.<key>`.
 */
const written = (key: string) => within(60, `The artifact naming ${key}`, new Promise<void>((done, fail) => {
  reported.catch(fail);

  const check = () => {
    const contents = read();

    if (!contents.includes(`ns0.${key}`)) return;

    const file = ts.createSourceFile(artifact, contents, ts.ScriptTarget.Latest) as ts.SourceFile & { parseDiagnostics: unknown[] };

    if (file.parseDiagnostics.length) return;

    watcher.close();
    done();
  };
  const watcher = watch(resolve(artifact, '..'), check);

  check();
}));

const gc = globalThis.gc ?? (() => { throw new Error('The dev project runs with --expose-gc.'); });

const heap = () => {
  gc();
  gc();

  return process.memoryUsage().heapUsed;
};

// No socket: nothing connects, and a port of its own would take the one of a
// dev server running beside it.
const server = await createServer({ root: APP, customLogger, server: { middlewareMode: true, ws: false } });

await written('k0');

const durations: number[] = [];
let retained = 0;

for (let change = 0; change < WARMUPS + CHANGES; change++) {
  if (change === WARMUPS) retained = heap();

  // A key no earlier change wrote, nor a prefix of one.
  const key = `change${String(change).padStart(2, '0')}`;
  const start = performance.now();

  // Every locale gains it, in one tick: a generation reads them together.
  catalogues.forEach((catalogue, at) => writeFileSync(catalogue, JSON.stringify({ ...data[at], [key]: 'changed' })));
  await written(key);

  if (change >= WARMUPS) durations.push(performance.now() - start);
}

retained = (heap() - retained) / CHANGES;

await server.close();

record(`a dev regeneration after a catalogue change, ${of(KEYS, 'namespaces')}`, 'time', 'ms', median(durations));
record(`heap retained per dev regeneration, ${of(KEYS, 'namespaces')}`, 'heap', 'B', retained);
