import 'server-only';
import type { AbstractIntlMessages } from 'use-intl/core';
import type { AppLocale } from './locale';

/** Dynamically import the catalog for a locale (server-only — catalogs must not leak into client bundles). */
export async function loadMessages(locale: AppLocale): Promise<AbstractIntlMessages> {
  const mod = await import(`../../messages/${locale}.json`);
  return mod.default as AbstractIntlMessages;
}
