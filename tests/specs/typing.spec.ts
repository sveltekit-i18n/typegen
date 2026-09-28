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
// The compiler's own entry, run by Node. The `node_modules/.bin` shim is an
// extensionless shell script on Windows, which `execFile` cannot spawn at all.
const TSC = resolve(HERE, '../../node_modules/typescript/bin/tsc');

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

// A SvelteKit app checks its JavaScript too.
const JS = ['--allowJs', '--checkJs'];

const compile = async (...files: string[]): Promise<string> => {
  const options = files.some((file) => file.endsWith('.js')) ? [...OPTIONS, ...JS] : OPTIONS;

  try {
    await run(process.execPath, [TSC, ...options, SCHEMA, ...files.map((file) => resolve(TYPING, file))]);

    return '';
  } catch (failure) {
    const reported = `${(failure as { stdout?: string }).stdout ?? ''}`.trim();

    // `tsc` reports on stdout and exits non-zero, which `execFile` rejects on.
    // A rejection carrying nothing is the compiler failing to run, and reading
    // that as a clean compile would pass every case in this file silently.
    if (!reported) throw failure;

    return reported;
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

const errorsIn = (output: string, file: string): string[] => (
  output.split('\n').filter((line) => line.includes(`${file}(`) && /\(\d+,\d+\): error TS/.test(line))
);

const expectEveryCallRejected = (output: string, file: string): void => {
  expect(errorsIn(output, file)).toHaveLength(5);
  expect(output).toContain("Argument of type '\"home.nope\"' is not assignable");
  expect(output).toContain("Type 'string' is not assignable to type 'number'");
  expect(output).toContain("'nmae' does not exist in type");
  expect(output).toContain("not assignable to parameter of type 'undefined'");
};

// The artifact registers the schema, and a 3.1 core reads the registration, so
// on one a cast the fixture forgot would still type the app. These cases state
// `schema: {} as TranslationSchema` and compile the WHOLE artifact against a
// 3.0 core (`sveltekit-i18n-3.0`, an aliased `sveltekit-i18n@3.0.0` with its own
// base 3.0.0), which ignores the block: the cast is all that types them, as it
// is for an app on 3.0 or on a 3.1 prerelease before 3.1.0-next.2.
describe('the emitted artifact, cast into a 3.0 core', () => {
  it('narrows every call the app gets right', async () => {
    await writeFile(SCHEMA, emit(SCHEMA_ENTRIES, 'en').contents, 'utf8');

    expect(await compile('ok.ts')).toBe('');
  });

  it('rejects every call the app gets wrong', async () => {
    await writeFile(SCHEMA, emit(SCHEMA_ENTRIES, 'en').contents, 'utf8');

    expectEveryCallRejected(await compile('bad.ts'), 'bad.ts');
  });

  it('opens a skipped namespace and leaves the rest narrow', async () => {
    await writeFile(SCHEMA, emit(SCHEMA_ENTRIES, 'en', [{ namespace: 'post', whole: false }]).contents, 'utf8');

    expect(await compile('skipped.ts')).toBe('');
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

// From base and `sveltekit-i18n` 3.1.0-next.2 on (3.1.0 once stable) the core
// reads the registration, and a config that states no schema is typed by it.
describe('the registration, compiled against a 3.1 core', () => {
  it('narrows every call the app gets right', async () => {
    await writeFile(SCHEMA, emit(SCHEMA_ENTRIES, 'en').contents, 'utf8');

    expect(await compile('registry/ok.ts')).toBe('');
  });

  it('rejects every call the app gets wrong', async () => {
    await writeFile(SCHEMA, emit(SCHEMA_ENTRIES, 'en').contents, 'utf8');

    expectEveryCallRejected(await compile('registry/bad.ts'), 'bad.ts');
  });

  it('opens a skipped namespace and leaves the rest narrow', async () => {
    await writeFile(SCHEMA, emit(SCHEMA_ENTRIES, 'en', [{ namespace: 'post', whole: false }]).contents, 'utf8');

    expect(await compile('registry/skipped.ts')).toBe('');
  });

  it('registers plain string keys before the first generation', async () => {
    await writeFile(SCHEMA, placeholder(), 'utf8');

    expect(await compile('registry/degrades.ts')).toBe('');
  });

  it('yields to a schema the config states', async () => {
    await writeFile(SCHEMA, emit(SCHEMA_ENTRIES, 'en').contents, 'utf8');

    expect(await compile('registry/explicit.ts')).toBe('');
  });

  it('yields to a cast of another schema on `sveltekit-i18n`', async () => {
    await writeFile(SCHEMA, emit(SCHEMA_ENTRIES, 'en').contents, 'utf8');

    expect(await compile('registry/cast.ts')).toBe('');
  });

  it('leaves an instance that opts out with `schema: {}` alone', async () => {
    await writeFile(SCHEMA, emit(SCHEMA_ENTRIES, 'en').contents, 'utf8');

    expect(await compile('registry/opt-out.ts')).toBe('');
  });

  it('types the instance `/kit` hands out', async () => {
    await writeFile(SCHEMA, emit(SCHEMA_ENTRIES, 'en').contents, 'utf8');

    expect(await compile('registry/kit.ts')).toBe('');
  });

  it('types a checked JavaScript file', async () => {
    await writeFile(SCHEMA, emit(SCHEMA_ENTRIES, 'en').contents, 'utf8');

    expect(await compile('registry/check.js')).toBe('');
  });

  it('reports a second registration of another schema', async () => {
    // Silent under `skipLibCheck: true`, where the first declaration wins; a
    // library must never register.
    await writeFile(SCHEMA, emit(SCHEMA_ENTRIES, 'en').contents, 'utf8');

    const output = await compile('registry/twice.ts');

    expect(errorsIn(output, 'twice.ts')).toEqual([expect.stringContaining('error TS2717')]);
  });
});
