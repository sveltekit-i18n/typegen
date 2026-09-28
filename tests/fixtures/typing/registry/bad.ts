import I18n from '@sveltekit-i18n/base';
import parser from '@sveltekit-i18n/parser-curly';

// Every line must be an error. The spec counts them, so one that stops being
// one fails the run.
const i18n = new I18n({ parser: parser({ onReport: null }), initLocale: 'en' });

i18n.t('home.nope', {});
i18n.t('home.count', { count: 'two' });
i18n.t('home.greeting');
i18n.t('home.greeting', { nmae: 'Ada' });
i18n.t('home.title', { any: 1 });
