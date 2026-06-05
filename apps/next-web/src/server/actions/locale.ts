'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { COOKIE, COOKIE_BASE, LOCALE_MAX_AGE } from '../cookies';
import { normalizeLocale, type AppLocale } from '@/i18n/locale';

/** Persist the user's UI language choice in the `pf_locale` cookie. */
export async function setLocale(next: AppLocale): Promise<void> {
  const locale = normalizeLocale(next);
  const store = await cookies();
  // Reuse the shared cookie base (path/sameSite/secure) but override httpOnly:
  // the locale is a UI preference that client JS may read.
  store.set(COOKIE.locale, locale, { ...COOKIE_BASE, maxAge: LOCALE_MAX_AGE, httpOnly: false });
  // Re-render server components with the new locale's messages.
  revalidatePath('/', 'layout');
}
