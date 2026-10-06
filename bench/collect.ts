import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { median, type Kind } from './compare.ts';

export type Row = { id: string; kind: Kind; unit: string; value: number };

// The tree measured, built by `run.ts`, and where its rows go.
const { BENCH_LIB, BENCH_OUT } = process.env;

if (!BENCH_LIB || !BENCH_OUT) throw new Error('The benchmark runs through `npm run bench`.');

export const LIB = BENCH_LIB;

const rows: Row[] = [];

// Written once the project has run to its end; a project that throws writes
// none, and `run.ts` reads it as failed.
process.on('exit', (code) => {
  if (code !== 0) return;

  mkdirSync(dirname(BENCH_OUT), { recursive: true });
  writeFileSync(BENCH_OUT, JSON.stringify(rows));
});

export const record = (id: string, kind: Kind, unit: string, value: number) => {
  rows.push({ id, kind, unit, value });
};

/**
 * The median duration of `fn` in milliseconds, over `rounds` calls after
 * `warmups` more. A generation runs once per build and once per change, so the
 * rows of the largest inputs time a single call, warmed by the smaller ones
 * before it.
 */
export const time = async (fn: () => unknown, { rounds = 5, warmups = 1 }: { rounds?: number; warmups?: number } = {}) => {
  for (let i = 0; i < warmups; i++) await fn();

  const durations: number[] = [];

  for (let i = 0; i < rounds; i++) {
    const start = performance.now();

    await fn();
    durations.push(performance.now() - start);
  }

  return median(durations);
};

/**
 * `work`, or an error once `seconds` pass: a project that waits on something
 * that never comes fails rather than holding the job.
 */
export const within = <T>(seconds: number, what: string, work: Promise<T>): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;

  return Promise.race([
    work,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} took over ${seconds} s.`)), seconds * 1000); }),
  ]).finally(() => clearTimeout(timer));
};
