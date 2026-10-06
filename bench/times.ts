import type { Collection } from '../src/types.js';

import { record, time } from './collect.ts';
import { of, SHAPES, SIZES } from './data.ts';
import { collection, config, emit, extract, probe } from './subject.ts';

// Each size warms the code for the next, and the largest is timed once: a
// generation derives and emits once per build and once per change.
const rounds = (keys: number) => ({ rounds: Math.max(1, Math.round(30_000 / keys)), warmups: keys < 10_000 ? 3 : 0 });

for (const shape of SHAPES) {
  for (const keys of SIZES) {
    const input = config(keys, shape);
    let derived: Collection | undefined;

    record(`derive, ${of(keys, shape)}`, 'time', 'ms', await time(async () => { derived = await collection({ config: input, probe: probe(), extract }); }, rounds(keys)));

    if (derived?.entries.length !== keys || derived.diagnostics.length) throw new Error(`The collection of ${of(keys, shape)} is not what it should be.`);

    const { entries, referenceLocale } = derived;

    record(`emit, ${of(keys, shape)}`, 'time', 'ms', await time(() => emit(entries, referenceLocale), rounds(keys)));
  }
}
