import I18n from 'sveltekit-i18n';

// What a skipped namespace has to allow, and what it must leave narrow.
const i18n = new I18n({ schema: {} as TranslationSchema, initLocale: 'en' });

i18n.t('post.anything');
i18n.t('post.anything', { with: 'a payload' });
i18n.t('home.title');

// @ts-expect-error Another namespace still narrows.
i18n.t('home.nope');

// @ts-expect-error A key the reference delivered keeps its payload.
i18n.t('home.count', { count: 'x' });
