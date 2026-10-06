/**
 * How a set of keys is laid out, as base's benchmark lays it out:
 * - `flat`: every key at the top, one namespace each.
 * - `namespaces`: namespaces of 20 keys.
 * - `single`: one namespace holding them all.
 * - `nested`: one namespace, each key a path of one segment per digit of its
 *   index (`n.d1.d2.k3`), so 10,000 keys nest four levels deep.
 */
export type Shape = 'flat' | 'namespaces' | 'single' | 'nested';

export const SHAPES: readonly Shape[] = ['flat', 'namespaces', 'single', 'nested'];

export const SIZES: readonly number[] = [1_000, 10_000, 100_000];

export const LOCALES: readonly string[] = ['en', 'cs'];

export type Table = Record<string, unknown>;

/** A number as a row's name spells it. */
export const n = (value: number) => value.toLocaleString('en-US');

const OF: Record<Shape, string> = {
  flat: 'flat keys',
  namespaces: 'keys in namespaces',
  single: 'keys in one namespace',
  nested: 'nested keys',
};

/** `keys` keys laid out by `shape`, as a row's name spells them. */
export const of = (keys: number, shape: Shape) => `${n(keys)} ${OF[shape]}`;

/**
 * The message of the key at `index`, in the Curly Message Format: one in four
 * takes no parameter, the others one, a typed one, and a selector with a
 * parameter under one of its branches.
 */
export const message = (index: number): string => [
  `v${index}`,
  `Hello, {{name}} ${index}`,
  `{{count:number}} items ${index}`,
  `{{gender; male:He said {{what}}; default:They}} ${index}`,
][index % 4];

/** `keys` leaves laid out by `shape`, by namespace. */
export const table = (keys: number, shape: Shape): Table => {
  const leaves = Array.from({ length: keys }, (_, i) => i);

  if (shape === 'flat') return Object.fromEntries(leaves.map((i) => [`k${i}`, message(i)]));

  if (shape === 'namespaces') {
    return Object.fromEntries(Array.from({ length: Math.ceil(keys / 20) }, (_, ns) => [
      `ns${ns}`,
      Object.fromEntries(leaves.slice(ns * 20, ns * 20 + 20).map((i) => [`k${i}`, message(i)])),
    ]));
  }

  if (shape === 'single') return { ns0: Object.fromEntries(leaves.map((i) => [`k${i}`, message(i)])) };

  const digits = `${keys - 1}`.length;

  // Built level by level rather than spread per key, which would be quadratic.
  const tree: Record<string, any> = Object.create(null);

  for (const i of leaves) {
    const path = `${i}`.padStart(digits, '0').split('');
    const last = path.pop() as string;
    let node = tree;

    for (const segment of path) node = node[`d${segment}`] ??= Object.create(null);

    node[`k${last}`] = message(i);
  }

  return { n: JSON.parse(JSON.stringify(tree)) };
};

/** A key of `table(keys, shape)`, as `t` reads it. */
export const key = (index: number, keys: number, shape: Shape): string => {
  if (shape === 'flat') return `k${index}`;

  if (shape === 'namespaces') return `ns${Math.floor(index / 20)}.k${index}`;

  if (shape === 'single') return `ns0.k${index}`;

  const path = `${index}`.padStart(`${keys - 1}`.length, '0').split('');
  const last = path.pop() as string;

  return ['n', ...path.map((segment) => `d${segment}`), `k${last}`].join('.');
};
