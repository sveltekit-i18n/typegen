import I18n from '@sveltekit-i18n/base';
import parser from '@sveltekit-i18n/parser-curly';

interface Other {
  'other.key': never;
}

// A schema the config states wins over the registered one.
const i18n = new I18n({ parser: parser({ onReport: null }), schema: {} as Other, initLocale: 'en' });

i18n.t('other.key');

// @ts-expect-error The registered schema does not reach this instance.
i18n.t('home.title');
