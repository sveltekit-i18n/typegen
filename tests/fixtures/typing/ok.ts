import I18n from 'sveltekit-i18n';

// Every call a correctly typed app makes. The schema is the one `emit` writes,
// read as a global — the artifact carries no import, so nothing imports it.
const i18n = new I18n({ schema: {} as TranslationSchema, initLocale: 'en' });

i18n.t('home.greeting', { name: 'Ada' });
i18n.t('home.count', { count: 2 });
i18n.t('home.choice', { gender: 'female' });
i18n.t('home.choice', {});
i18n.t('home.title');
i18n.t('home.odd key');
i18n.t('keys.only');
i18n.t('keys.only', { whatever: true });
i18n.l('en', 'home.greeting', { name: 'Ada' });
