import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { COOKIE } from '../server/cookies';
import { normalizeLocale } from './locale';
import { loadMessages } from './messages';

/**
 * Resolves the active locale per request from the `pf_locale` cookie
 * (no URL-based routing) and loads the matching message catalog.
 */
export default getRequestConfig(async () => {
  // `requestLocale` (URL segment) is intentionally ignored — locale comes solely
  // from the pf_locale cookie. Explicit getTranslations({locale}) overrides are unused by design.
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(COOKIE.locale)?.value);
  return {
    locale,
    messages: await loadMessages(locale),
  };
});
