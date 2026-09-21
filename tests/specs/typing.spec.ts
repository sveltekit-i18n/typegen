import { execFile } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, describe, expect, it } from 'vitest';

import { emit, placeholder } from '../../src/emit.js';
import type { Entry } from '../../src/types.js';

const run = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const TYPING = resolve(HERE, '../fixtures/typing');
const SCHEMA = resolve(TYPING, 'schema.d.ts');
const TSC = resolve(HERE, '../../node_modules/.bin/tsc');

/**
 * The compiler settings a SvelteKit app runs under, except for `skipLibCheck`.
 *
 * Kit's generated tsconfig turns that on, and it HIDES two regressions this
 * artifact can have: a `type` alias instead of an interface is a duplicate
 * identifier, and a key a user redeclares differently is TS2717. Both would
 * pass here and break for a consumer who does not set the flag.
 */
const OPTIONS = [
  '--noEmit',
  '--strict',
  '--skipLibCheck', 'false',
  '--target', 'es2022',
  '--module', 'esnext',
  '--moduleResolution', 'bundler',
  '--isolatedModules',
  '--verbatimModuleSyntax',
];

const compile = async (...files: string[]): Promise<string> => {
  try {
    await run(TSC, [...OPTIONS, SCHEMA, ...files.map((file) => resolve(TYPING, file))]);

    return '';
  } catch (failure) {
    // `tsc` reports on stdout and exits non-zero, which `execFile` rejects on.
    return `${(failure as { stdout?: string }).stdout ?? ''}`.trim();
  }
};

const entry = (key: string, value: unknown, params: Entry['params'] = []): Entry => ({ key, value, params });

const SCHEMA_ENTRIES: Entry[] = [
  entry('home.greeting', 'Hello, {{name}}!', [{ name: 'name' }]),
  entry('home.count', '{{count:number}} items', [{ name: 'count', kind: 'number' }]),
  entry('home.choice', '{{gender; male: He; default: They}}', [{ name: 'gender', values: ['male'], optional: true }]),
  entry('home.title', 'Fixture'),
  entry('home.odd key', 'Weird'),
  entry('keys.only', 'Hi {{name}}', null),
];

afterAll(() => rm(SCHEMA, { force: true }));

describe('the emitted artifact, compiled against the published types', () => {
  it('narrows every call the app gets right', async () => {
    await writeFile(SCHEMA, emit(SCHEMA_ENTRIES, 'en').contents, 'utf8');

    expect(await compile('ok.ts')).toBe('');
  });

  it('rejects every call the app gets wrong', async () => {
    await writeFile(SCHEMA, emit(SCHEMA_ENTRIES, 'en').contents, 'utf8');

    const output = await compile('bad.ts');
    const errors = output.split('\n').filter((line) => /bad\.ts\(\d+,\d+\): error TS/.test(line));

    expect(errors).toHaveLength(5);
    expect(output).toContain("Argument of type '\"home.nope\"' is not assignable");
    expect(output).toContain("Type 'string' is not assignable to type 'number'");
    expect(output).toContain("'nmae' does not exist in type");
    expect(output).toContain("not assignable to parameter of type 'undefined'");
  });

  it('compiles a project that has never generated', async () => {
    // The hole the placeholder closes: without a file the app does not compile
    // at all, and the error names `TranslationSchema` rather than anything the
    // developer can act on.
    await writeFile(SCHEMA, placeholder(), 'utf8');

    expect(await compile('degrades.ts')).toBe('');
  });

  it('carries no top-level import or export', () => {
    // One would turn the artifact into a module, and the global the app reads
    // by bare name would vanish with an error pointing at the consumer.
    const { contents } = emit(SCHEMA_ENTRIES, 'en');

    expect(contents.split('\n').some((line) => /^\s*(import|export)\b/.test(line))).toBe(false);
    expect(placeholder().split('\n').some((line) => /^\s*(import|export)\b/.test(line))).toBe(false);
  });
});
