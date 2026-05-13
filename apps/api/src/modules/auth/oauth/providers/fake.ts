/**
 * Test-only OAuth provider for integration / unit tests. Registered in
 * `oauth.registry.ts` only when NODE_ENV === 'test' AND
 * OAUTH_TEST_PROVIDER === 'true'. Never reachable from production.
 *
 * The "authorization URL" it returns is a redirect straight back to the
 * callback with deterministic `code` + `state` query params, which lets
 * an integration test drive the full callback path end-to-end without
 * spinning up a real provider sandbox.
 *
 * `exchangeCode` returns a token derived from the code; `fetchUserInfo`
 * decodes that token back into the test-controlled subject/email/etc.
 * via a small in-memory map keyed by code.
 */

import type { OAuthProvider } from '../types.js';

interface FakeIdentity {
  subject:        string;
  email:          string | null;
  emailVerified:  boolean;
  name:           string | null;
  avatarUrl:      string | null;
}

const codeToIdentity = new Map<string, FakeIdentity>();

/**
 * Register a fake identity that the next callback with `code` will resolve
 * to. The integration test calls this BEFORE driving /auth/oauth/fake/start.
 */
export function registerFakeIdentity(code: string, identity: FakeIdentity): void {
  codeToIdentity.set(code, identity);
}

/** Wipe all registered fake identities (call from afterEach for isolation). */
export function clearFakeIdentities(): void {
  codeToIdentity.clear();
}

export function createFakeProvider(): OAuthProvider {
  return {
    name: 'fake',

    getAuthorizationUrl({ state, redirectUri }) {
      // The test harness picks a code at registration time. The
      // authorization URL is a redirect straight back to the callback —
      // emulates a user instantly approving consent.
      const params = new URLSearchParams({ state, code: 'fake-code-default' });
      return `${redirectUri}?${params.toString()}`;
    },

    async exchangeCode({ code }) {
      // The "access token" is just the code echoed back; fetchUserInfo
      // uses it to look up the registered identity.
      return {
        accessToken: code,
        refreshToken: null,
        idToken:     null,
        expiresAt:   null,
      };
    },

    async fetchUserInfo(accessToken) {
      const identity = codeToIdentity.get(accessToken);
      if (!identity) {
        throw new Error(`fake provider: no identity registered for code "${accessToken}"`);
      }
      return identity;
    },
  };
}
