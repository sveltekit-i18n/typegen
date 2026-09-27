import greeting from 'virtual:greeting';

// A config that reads its catalogue from a module a plugin of the app serves.
export const config = {
  initLocale: 'en',
  loaders: [{ namespace: 'home', locale: 'en', loader: async () => greeting }],
};
