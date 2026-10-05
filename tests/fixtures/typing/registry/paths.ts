// The levels the registered tree points to: every key a node names is its own
// path, every key the tree lists has a node, and a node is open exactly where
// a pattern is. Whatever else the program declares.
type Equal<A, B> = (<X>() => X extends A ? 1 : 2) extends (<X>() => X extends B ? 1 : 2) ? true : false;

type Tree = SvelteKitI18n.Register['tree'];
type Walk<Level, Path extends string> = {
  [Segment in keyof Level & string]: (Level[Segment] extends { key: infer Key } ? ['key', `${Path}${Segment}`, Key] : never)
    | (Level[Segment] extends { open: true } ? ['open', `${Path}${Segment}.${string}`] : never)
    | (Level[Segment] extends { next: infer Next } ? Walk<Next, `${Path}${Segment}.`> : never)
}[keyof Level & string];
type Nodes = Walk<Tree['next'], ''>;
type Named = Extract<Nodes, ['key', string, unknown]>;
type Misplaced<N> = N extends ['key', infer Path, infer Key] ? Equal<Path, Key> extends true ? never : N : never;

const own: Equal<Misplaced<Named>, never> = true;
const listed: Tree['keys'] extends Named[2] ? true : false = true;
const covered: Named[2] extends Tree['keys'] | Tree['patterns'] ? true : false = true;
const open: Equal<Extract<Nodes, ['open', string]>[1], Tree['patterns']> = true;
// Not vacuous: the tree names keys at all.
const reached: Equal<Named, never> = false;

export { own, listed, covered, open, reached };
