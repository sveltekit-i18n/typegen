// A second registration, as a library shipping one would add to the app's
// program. A script, like the artifact: the namespace is global.
declare namespace SvelteKitI18n {
  interface Register {
    schema: { 'library.key': never };
  }
}
