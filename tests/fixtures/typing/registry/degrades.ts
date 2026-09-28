import I18n from '@sveltekit-i18n/base';
import parser from '@sveltekit-i18n/parser-curly';

// What the placeholder's registration has to allow: a project compiles before
// the first generation, with plain `string` keys.
const i18n = new I18n({ parser: parser({ onReport: null }), initLocale: 'en' });

i18n.t('anything.at.all');
i18n.t('anything.at.all', { and: 'a payload' });
