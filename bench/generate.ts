import { generation, KEYS } from './build.ts';
import { record } from './collect.ts';
import { of } from './data.ts';

// A build's generation on the pre-bundles an earlier one left.
const { duration, loads } = await generation(false);

record(`config loads, a build's generation (${of(KEYS, 'namespaces')})`, 'count', '', loads);
record(`a build's generation, ${of(KEYS, 'namespaces')}`, 'time', 'ms', duration);
