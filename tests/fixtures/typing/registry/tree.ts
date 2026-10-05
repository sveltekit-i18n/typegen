// The tree the registration carries for the typed-access extension, which
// trusts it only while it was built from the schema's own key set: the literal
// keys and the patterns, apart, since a pattern absorbs the literals it
// matches in `keyof`.
type Equal<A, B> = (<X>() => X extends A ? 1 : 2) extends (<X>() => X extends B ? 1 : 2) ? true : false;

type Tree = SvelteKitI18n.Register['tree'];
type IsPattern<K extends string> = Record<never, never> extends Record<K, 1> ? true : false;
type Literals<S> = keyof { [K in keyof S as K extends string ? IsPattern<K> extends true ? never : K : never]: 1 };
type Patterns<S> = keyof { [K in keyof S as K extends string ? IsPattern<K> extends true ? K : never : never]: 1 };

const keys: Equal<Literals<TranslationSchema>, Tree['keys']> = true;
const patterns: Equal<Patterns<TranslationSchema>, Tree['patterns']> = true;

export { keys, patterns };
