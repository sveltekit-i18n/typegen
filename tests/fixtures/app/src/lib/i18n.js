import { dev } from '$app/env';

import en from '#lib/translations/en.json';
import cs from '#lib/translations/cs.json';

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

export const partial = {
  initLocale: 'en',
  loaders: [descriptor('home', 'en'), { namespace: 'home', locale: 'cs', loader: async () => ({ title: 'Fixture', extra: 'Navíc' }) }],
};

export const unchecked = {
  ...config,
  loaders: [...config.loaders, { namespace: 'gone', locale: 'cs', loader: async () => { throw new Error('the catalogue is gone'); } }],
};

export const listed = {
  initLocale: 'en',
  loaders: [{
    namespace: ['home', 'about'],
    locale: ['en', 'cs'],
    loader: async ({ locale, namespace }) => (
      namespace === 'home' ? (await import(`./translations/home/${locale}.json`)).default : { title: locale === 'en' ? 'About' : 'O nás' }
    ),
  }],
};

// A `sanitizeLocales` a second pass does not leave alone.
export const sanitized = {
  ...config,
  sanitizeLocales: (locale) => ({ en: 'en-US' })[locale] ?? locale.toLowerCase(),
};

export const moded = {
  initLocale: 'en',
  loaders: [{ namespace: 'mode', locale: 'en', loader: async () => ({ [import.meta.env.VITE_WHERE ?? 'unset']: import.meta.env.MODE }) }],
};

// A loader that holds on once it has read its catalogue, until a spec lets it
// go, so the catalogue can change under a generation that already read it.
export const gated = {
  initLocale: 'en',
  loaders: [{
    namespace: 'home',
    locale: 'en',
    loader: async () => {
      const data = (await import('./translations/home/en.json')).default;
      const { access, writeFile } = await import('node:fs/promises');
      const gate = process.env.TYPEGEN_GATE;

      await writeFile(`${gate}.read`, '');

      while (!await access(`${gate}.go`).then(() => true, () => false)) await new Promise((next) => { setTimeout(next, 25); });

      return data;
    },
  }],
};
