import I18n from '@sveltekit-i18n/base';
import parser from '@sveltekit-i18n/parser-curly';

// Every call a correctly typed app makes, on a config that states no schema:
// the artifact registers it in `SvelteKitI18n.Register`, and the core reads it
// from there.
const i18n = new I18n({ parser: parser({ onReport: null }), initLocale: 'en' });

i18n.t('home.greeting', { name: 'Ada' });
i18n.t('home.count', { count: 2 });
i18n.t('home.choice', { gender: 'female' });
i18n.t('home.choice', {});
i18n.t('home.title');
i18n.t('home.odd key');
i18n.t('keys.only');
i18n.t('keys.only', { whatever: true });
i18n.l('en', 'home.greeting', { name: 'Ada' });
