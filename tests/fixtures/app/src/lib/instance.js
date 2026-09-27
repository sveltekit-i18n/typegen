import I18n from 'sveltekit-i18n';

// The README's shape: the module that exports the config also builds the
// app's instance from it.
export const config = {
  initLocale: 'en',
  loaders: [{ namespace: 'home', locale: 'en', loader: async () => (await import('./translations/home/en.json')).default }],
};

export default new I18n(config);
