import I18n from '@sveltekit-i18n/base';
import parser from '@sveltekit-i18n/parser-curly';

// What a skipped namespace has to allow through the registration, and what it
// must leave narrow.
const i18n = new I18n({ parser: parser({ onReport: null }), initLocale: 'en' });

i18n.t('post.anything');
i18n.t('post.anything', { with: 'a payload' });
i18n.t('home.title');

// @ts-expect-error Another namespace still narrows.
i18n.t('home.nope');

// @ts-expect-error A key the reference delivered keeps its payload.
i18n.t('home.count', { count: 'x' });
