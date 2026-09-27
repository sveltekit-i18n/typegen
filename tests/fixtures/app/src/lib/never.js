// A config whose loader imports a module an app plugin never finishes loading.
export const config = {
  initLocale: 'en',
  loaders: [{ namespace: 'home', locale: 'en', loader: async () => (await import('virtual:never')).default }],
};
