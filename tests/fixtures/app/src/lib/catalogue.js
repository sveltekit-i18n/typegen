import catalogue from '@fixture/catalogue';

// A config that reads its catalogue from a linked CommonJS workspace package.
export const config = {
  initLocale: 'en',
  loaders: [{ namespace: 'home', locale: 'en', loader: async () => catalogue }],
};
