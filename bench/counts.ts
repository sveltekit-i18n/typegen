import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

import type { DeriveInput } from '../src/derive.js';

import { LIB, record } from './collect.ts';
import { key, LOCALES, of, SHAPES, SIZES, type Shape } from './data.ts';
import { collection, config, emit, extract, probe } from './subject.ts';

const KEYS = 10_000;

// What a generation calls, counted: each loader once, the extractor once per
// key of the reference locale, and the core once per locale.
{
  const input = config(KEYS, 'namespaces');
  const calls = { loader: 0, addTranslations: 0, extract: 0 };
  const counted = probe();

  await collection({
    config: { ...input, loaders: input.loaders?.map((descriptor) => ({ ...descriptor, loader: () => { calls.loader++; return descriptor.loader(); } })) },
    probe: { ...counted, addTranslations: (table) => { calls.addTranslations++; counted.addTranslations(table); } },
    extract: ((...args) => { calls.extract++; return extract!(...args); }) as DeriveInput['extract'],
  });

  record(`loader calls, a generation (${of(KEYS, 'namespaces')}, ${LOCALES.length} locales)`, 'count', '', calls.loader);
  record(`extractor calls, a generation (${of(KEYS, 'namespaces')})`, 'count', '', calls.extract);
  record(`addTranslations calls, a generation (${of(KEYS, 'namespaces')}, ${LOCALES.length} locales)`, 'count', '', calls.addTranslations);
}

const artifacts = new Map<Shape, string>();

for (const shape of SHAPES) {
  for (const keys of SIZES) {
    const { entries, referenceLocale } = await collection({ config: config(keys, shape), probe: probe(), extract });
    const { contents } = emit(entries, referenceLocale);

    if (keys === KEYS) artifacts.set(shape, contents);

    record(`the artifact, ${of(keys, shape)}`, 'size', 'B', Buffer.byteLength(contents));
  }
}

// What the artifact costs the checker of an app that registers it, as an
// editor checks a file calling `t`: the core's types are the installed
// `sveltekit-i18n`'s, the same on both sides. The artifact is checked as a
// source file, which `skipLibCheck` would skip as a declaration file, so its
// own declarations count too: the tree's levels, which the core never reads.
const PROBE = [
  "import { I18n } from 'sveltekit-i18n';",
  '',
  'const i18n = new I18n({ loaders: [] });',
  '',
  'i18n.t(KEY0);',
  "i18n.t(KEY1, { name: 'x' });",
  'i18n.t(KEY2, { count: 1 });',
  "i18n.t(KEY3, { gender: 'male', what: 'x' });",
  '',
  '// The schema narrows: a key with a parameter takes its payload.',
  '// @ts-expect-error',
  'i18n.t(KEY1);',
  '',
].join('\n');

for (const [shape, artifact] of artifacts) {
  const dir = join(LIB, 'probe', shape);
  // One key of each kind of message: none, one, a typed and a selector parameter.
  const indexes = [0, 1, 22, 43];

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'schema.ts'), artifact);
  writeFileSync(join(dir, 'probe.ts'), indexes.reduce((text, index, at) => text.replaceAll(`KEY${at}`, `'${key(index, KEYS, shape)}'`), PROBE));

  const program = ts.createProgram({
    rootNames: [join(dir, 'probe.ts'), join(dir, 'schema.ts')],
    options: {
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      types: [],
    },
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);

  if (diagnostics.length) throw new Error(`The probe of ${of(KEYS, shape)} does not compile: ${ts.flattenDiagnosticMessageText(diagnostics[0].messageText, '\n')}`);

  const checker = program.getTypeChecker() as ts.TypeChecker & { getTypeCount(): number; getInstantiationCount(): number };

  record(`checker types, the artifact of ${of(KEYS, shape)} and five t calls`, 'count', '', checker.getTypeCount());
  record(`checker instantiations, the artifact of ${of(KEYS, shape)} and five t calls`, 'count', '', checker.getInstantiationCount());
}
