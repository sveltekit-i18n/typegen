import { dev } from '$app/environment';

import en from '$lib/translations/en.json';

export const config = {
  initLocale: 'en',
  loaders: [
    { namespace: 'home', locale: 'en', loader: async () => en },
    { namespace: 'mode', locale: 'en', loader: async () => ({ only: dev ? 'in dev' : 'in production' }) },
  ],
};
