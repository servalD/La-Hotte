/** I18N-01 : français par défaut, anglais prêt. */
export const LOCALES = ['fr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'fr';

/** Cookie de préférence de langue. En phase 1, la langue du profil actif prendra le relais. */
export const LOCALE_COOKIE = 'locale';

export function isLocale(value: string | undefined): value is Locale {
  return LOCALES.includes(value as Locale);
}
