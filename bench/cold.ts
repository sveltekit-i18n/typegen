import { generation, KEYS } from './build.ts';
import { record } from './collect.ts';
import { of } from './data.ts';

// A build's generation on no pre-bundles, as on a fresh clone.
const { duration } = await generation(true);

record(`a build's first generation, on an empty cache, ${of(KEYS, 'namespaces')}`, 'time', 'ms', duration);
