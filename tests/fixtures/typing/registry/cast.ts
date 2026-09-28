import I18n from 'sveltekit-i18n';

interface Other {
  'other.key': { count: number };
}

// A cast of another schema wins over the registered one on `sveltekit-i18n`
// as well: its keys narrow, and the registered ones do not reach the instance.
const i18n = new I18n({ schema: {} as Other, initLocale: 'en' });

i18n.t('other.key', { count: 2 });

// @ts-expect-error The cast's payload, not a plain one.
i18n.t('other.key', { count: 'two' });

// @ts-expect-error The registered schema does not reach this instance.
i18n.t('home.title');
