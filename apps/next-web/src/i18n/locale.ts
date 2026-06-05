/**
 * Supported UI locales. `en` is the source-of-truth catalog; `id` mirrors it.
 * Locale is chosen via the `pf_locale` cookie (no URL-based routing).
 */
export const SUPPORTED_LOCALES = ['en', 'id'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = 'en';

/** Normalize an arbitrary cookie/header value to a supported locale. */
export function normalizeLocale(value: string | null | undefined): AppLocale {
  if (!value) return DEFAULT_LOCALE;
  const base = value.trim().toLowerCase().split('-')[0];
  return (SUPPORTED_LOCALES as readonly string[]).includes(base)
    ? (base as AppLocale)
    : DEFAULT_LOCALE;
}
