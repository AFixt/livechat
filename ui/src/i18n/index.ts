import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './en.json' with { type: 'json' };

/**
 * Initialize i18next with English resources; additional locales loaded later.
 * @returns The configured i18n instance.
 */
export function initI18n(): typeof i18n {
  void i18n.use(initReactI18next).init({
    resources: { en: { translation: en } },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
  return i18n;
}
