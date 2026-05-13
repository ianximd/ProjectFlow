/**
 * Env-gated provider registry.
 *
 * - A provider is enabled only when both its CLIENT_ID and CLIENT_SECRET
 *   env vars are set. A deployment with no OAuth credentials configured
 *   boots cleanly and `/auth/oauth/providers` simply returns [].
 * - The fake provider is enabled only in test mode + an explicit opt-in
 *   env var, so production cannot accidentally surface it.
 *
 * Lazy-initialised: env vars are read at first access so test setupFiles
 * (which run BEFORE the test file imports anything) can mutate them.
 */

import type { OAuthProvider, OAuthProviderName } from './types.js';
import { createGoogleProvider }                 from './providers/google.js';
import { createFakeProvider }                   from './providers/fake.js';

let cache: Map<OAuthProviderName, OAuthProvider> | null = null;

function build(): Map<OAuthProviderName, OAuthProvider> {
  const map = new Map<OAuthProviderName, OAuthProvider>();

  const googleId     = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const googleSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (googleId && googleSecret) {
    map.set('google', createGoogleProvider({
      clientId:     googleId,
      clientSecret: googleSecret,
    }));
  }

  if (process.env.NODE_ENV === 'test' && process.env.OAUTH_TEST_PROVIDER === 'true') {
    map.set('fake', createFakeProvider());
  }

  return map;
}

function ensure(): Map<OAuthProviderName, OAuthProvider> {
  if (!cache) cache = build();
  return cache;
}

/**
 * Reset the registry — only used by tests that swap env vars between
 * cases. No-op in normal operation.
 */
export function resetRegistry(): void {
  cache = null;
}

export function getEnabledProviders(): { name: OAuthProviderName }[] {
  return Array.from(ensure().keys()).map((name) => ({ name }));
}

export function getProvider(name: string): OAuthProvider | null {
  return ensure().get(name as OAuthProviderName) ?? null;
}

/**
 * Resolve the absolute callback URL for a given provider. Computed
 * fresh per-request so deployments behind proxies (where the perceived
 * host changes) work without re-deploys.
 */
export function callbackUrl(provider: OAuthProviderName, baseUrl?: string): string {
  const base = baseUrl
    ?? process.env.OAUTH_REDIRECT_BASE_URL
    ?? `http://localhost:${process.env.PORT ?? '3001'}`;
  return `${base.replace(/\/$/, '')}/api/v1/auth/oauth/${provider}/callback`;
}
