import { dev } from '$app/environment';

import en from '$lib/translations/en.json';
import cs from '$lib/translations/cs.json';

// A dynamic template-literal import, the shape a real app uses: nothing static
// can tell which files it reaches, which is why the generator evaluates it.
const descriptor = (namespace, locale) => ({
  namespace,
  locale,
  routes: [`/${namespace === 'home' ? '' : namespace}`],
  loader: async () => (await import(`./translations/${namespace}/${locale}.json`)).default,
});

export const config = {
  initLocale: 'en',
  fallbackLocale: 'en',
  translations: { en, cs },
  loaders: ['en', 'cs'].map((locale) => descriptor('home', locale)),
};

// The awkward shapes a spec drives the plugin through, as further exports of
// the one config module.
export const branching = {
  initLocale: 'en',
  loaders: [{ namespace: 'mode', locale: 'en', loader: async () => ({ only: dev ? 'in dev' : 'in production' }) }],
};

export const routed = {
  initLocale: 'en',
  loaders: [{ namespace: 'where', locale: 'en', routes: ['/deep/page'], loader: async ({ route }) => ({ route }) }],
};

export const throwing = {
  ...config,
  loaders: [...config.loaders, { namespace: 'gone', locale: 'en', loader: async () => { throw new Error('the catalogue is gone'); } }],
};

export const nameless = { loaders: [] };
