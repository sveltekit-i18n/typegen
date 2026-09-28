import I18n from '@sveltekit-i18n/base';
import parser from '@sveltekit-i18n/parser-curly';

// `schema: {}` states a schema without a closed key set: plain `string` keys,
// whatever the registry holds.
const i18n = new I18n({ parser: parser({ onReport: null }), schema: {}, initLocale: 'en' });

i18n.t('anything.at.all', { and: 'a payload' });
i18n.t('home.count', { count: 'two' });
