import { createHash } from 'node:crypto';
import type { OAuthProvider, OAuthAuthorizationUrlInput, OAuthTokens, OAuthUserInfo } from '../types.js';

/**
 * Microsoft Identity Platform v2.0.
 *
 * Critical gotcha: when the tenant is 'common' (any work/school/personal
 * account), the OIDC `sub` claim is **tenant-scoped** — the same human
 * gets a different `sub` depending on which Microsoft tenant they sign
 * in from. The right stable identifier is the user's directory object
 * id, exposed as `id` on Microsoft Graph /me (also as `oid` in the
 * id_token claims). We use that as `subject`, NOT `sub`.
 *
 * Tenant defaults to 'common' so any Microsoft account can sign in. Set
 * `MICROSOFT_OAUTH_TENANT` to a specific tenant GUID to lock to a single
 * directory (e.g. an enterprise SSO deployment), or 'organizations' to
 * exclude personal MSA accounts.
 *
 * PKCE is required for confidential web clients per Microsoft's v2.0
 * security guidance — included on every flow regardless of secret use.
 */

const SCOPES = ['openid', 'email', 'profile', 'User.Read', 'offline_access'];

function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export interface MicrosoftProviderConfig {
  clientId:     string;
  clientSecret: string;
  tenant:       string; // 'common' | 'organizations' | 'consumers' | a tenant GUID
}

export function createMicrosoftProvider(config: MicrosoftProviderConfig): OAuthProvider {
  const authBase = `https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/authorize`;
  const tokenUrl = `https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/token`;
  const meUrl    = 'https://graph.microsoft.com/v1.0/me';

  return {
    name: 'microsoft',

    getAuthorizationUrl({ state, nonce, pkceVerifier, redirectUri }: OAuthAuthorizationUrlInput): string {
      const params = new URLSearchParams({
        client_id:             config.clientId,
        redirect_uri:          redirectUri,
        response_type:         'code',
        response_mode:         'query',
        scope:                 SCOPES.join(' '),
        state,
        nonce,
        code_challenge:        pkceChallenge(pkceVerifier),
        code_challenge_method: 'S256',
        // `prompt=select_account` so a user with multiple Microsoft
        // accounts (work + personal) gets the picker.
        prompt:                'select_account',
      });
      return `${authBase}?${params.toString()}`;
    },

    async exchangeCode({ code, pkceVerifier, redirectUri }): Promise<OAuthTokens> {
      const body = new URLSearchParams({
        client_id:     config.clientId,
        client_secret: config.clientSecret,
        code,
        code_verifier: pkceVerifier,
        grant_type:    'authorization_code',
        redirect_uri:  redirectUri,
        scope:         SCOPES.join(' '),
      });

      const res = await fetch(tokenUrl, {
        method:  'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal:  AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Microsoft token exchange failed (${res.status}): ${text.slice(0, 200)}`);
      }
      const json = await res.json() as {
        access_token:  string;
        refresh_token?: string;
        id_token?:     string;
        expires_in?:   number;
      };
      return {
        accessToken:  json.access_token,
        refreshToken: json.refresh_token ?? null,
        idToken:      json.id_token ?? null,
        expiresAt:    json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null,
      };
    },

    async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
      const body = new URLSearchParams({
        client_id:     config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
        // MS rejects refresh requests that omit a scope — pass the same
        // set we asked for at consent so the new access token has parity.
        scope:         SCOPES.join(' '),
      });
      const res = await fetch(tokenUrl, {
        method:  'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal:  AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Microsoft token refresh failed (${res.status}): ${text.slice(0, 200)}`);
      }
      const json = await res.json() as {
        access_token:  string;
        refresh_token?: string;
        id_token?:     string;
        expires_in?:   number;
      };
      return {
        accessToken:  json.access_token,
        // MS rotates the refresh token on every refresh — store the new one.
        refreshToken: json.refresh_token ?? null,
        idToken:      json.id_token ?? null,
        expiresAt:    json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null,
      };
    },

    async fetchUserInfo(accessToken: string): Promise<OAuthUserInfo> {
      const res = await fetch(meUrl, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal:  AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        throw new Error(`Microsoft Graph /me failed: ${res.status}`);
      }
      const me = await res.json() as {
        id:                string; // === oid claim, stable across tenants
        displayName?:      string;
        mail?:             string | null;
        userPrincipalName?: string;
      };

      // Email: Graph returns `mail` for accounts with a real mailbox,
      // null for personal MSA users. Fall back to userPrincipalName,
      // which for MSA accounts is the email-shaped login. Microsoft
      // doesn't expose a per-email "verified" bit on Graph /me — for
      // organisation accounts the email is provisioned by the admin
      // (treat as verified); for MSA the UPN is what the user signed in
      // with (treat as verified). Conservative default: false.
      const email = me.mail ?? me.userPrincipalName ?? null;

      return {
        subject:       me.id, // <-- oid, NOT sub
        email,
        emailVerified: !!email, // see comment above; conservative for now
        name:          me.displayName ?? null,
        avatarUrl:     null,    // Graph /photo/$value is a separate call; skip for v1
      };
    },
  };
}
