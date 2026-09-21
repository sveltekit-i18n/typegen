import { dev } from '$app/environment';

import en from '$lib/translations/en.json';
import cs from '$lib/translations/cs.json';

// A dynamic template-literal import, the shape a real app uses: nothing static
// can tell which files it reaches, which is why the generator evaluates it.
const namespace = (key, locale) => ({
  key,
  locale,
  routes: [`/${key === 'home' ? '' : key}`],
  loader: async () => (await import(`./translations/${key}/${locale}.json`)).default,
});

export const config = {
  initLocale: 'en',
  fallbackLocale: 'en',
  translations: { en, cs },
  loaders: ['en', 'cs'].map((locale) => namespace('home', locale)),
};

// The awkward shapes a spec drives the plugin through, as further exports of
// the one config module.
export const branching = {
  initLocale: 'en',
  loaders: [{ key: 'mode', locale: 'en', loader: async () => ({ only: dev ? 'in dev' : 'in production' }) }],
};

export const routed = {
  initLocale: 'en',
  loaders: [{ key: 'where', locale: 'en', routes: ['/deep/page'], loader: async ({ route }) => ({ route }) }],
};

export const throwing = {
  ...config,
  loaders: [...config.loaders, { key: 'gone', locale: 'en', loader: async () => { throw new Error('the catalogue is gone'); } }],
};

export const nameless = { loaders: [] };
