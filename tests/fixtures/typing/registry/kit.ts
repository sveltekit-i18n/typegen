import { defineI18n } from '@sveltekit-i18n/base/kit';
import parser from '@sveltekit-i18n/parser-curly';

// The instance `/kit` hands out is typed by the registry too.
const { get } = defineI18n({ parser: parser({ onReport: null }), initLocale: 'en' });
const i18n = get();

i18n.t('home.greeting', { name: 'Ada' });
i18n.t('home.title');

// @ts-expect-error An unknown key.
i18n.t('home.nope');

// @ts-expect-error A payload of the wrong type.
i18n.t('home.count', { count: 'two' });
