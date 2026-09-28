import I18n from '@sveltekit-i18n/base';
import parser from '@sveltekit-i18n/parser-curly';

// A JavaScript app checked by the compiler reads the registry as well.
const i18n = new I18n({ parser: parser({ onReport: null }), initLocale: 'en' });

i18n.t('home.greeting', { name: 'Ada' });

// @ts-expect-error An unknown key.
i18n.t('home.nope');

// @ts-expect-error A payload of the wrong type.
i18n.t('home.count', { count: 'two' });
