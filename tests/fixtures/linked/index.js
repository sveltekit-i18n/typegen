import I18n from 'sveltekit-i18n';
import copy from 'which-copy';

// A workspace package that builds the app's instance, linked into the app
// rather than installed. Its locale names the copy of `which-copy` it reached,
// so a spec can tell whether the app's `resolve.dedupe` was honoured.
export const config = {
  initLocale: copy,
  loaders: [{ namespace: 'home', locale: copy, loader: async () => ({ title: 'Linked' }) }],
};

export default new I18n(config);
