import { appendFileSync } from 'node:fs';

// Leaves one mark per collection, so a spec can count how often a build
// evaluated the config.
export const config = {
  initLocale: 'en',
  loaders: [{
    namespace: 'home',
    locale: 'en',
    loader: async () => {
      appendFileSync(process.env.TYPEGEN_COUNT, 'x');

      return (await import('./translations/home/en.json')).default;
    },
  }],
};
