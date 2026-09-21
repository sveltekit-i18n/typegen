import I18n from 'sveltekit-i18n';

// What the placeholder has to allow: a project compiles before the first
// generation, with plain `string` keys.
const i18n = new I18n({ schema: {} as TranslationSchema, initLocale: 'en' });

i18n.t('anything.at.all');
i18n.t('anything.at.all', { and: 'a payload' });
