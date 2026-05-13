import { createHash } from 'node:crypto';
import type { OAuthProvider, OAuthAuthorizationUrlInput, OAuthTokens, OAuthUserInfo } from '../types.js';

const AUTH_URL     = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL    = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

const SCOPES = ['openid', 'email', 'profile'];

function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export interface GoogleProviderConfig {
  clientId:     string;
  clientSecret: string;
}

export function createGoogleProvider(config: GoogleProviderConfig): OAuthProvider {
  return {
    name: 'google',

    getAuthorizationUrl({ state, nonce, pkceVerifier, redirectUri }: OAuthAuthorizationUrlInput): string {
      const params = new URLSearchParams({
        client_id:             config.clientId,
        redirect_uri:          redirectUri,
        response_type:         'code',
        scope:                 SCOPES.join(' '),
        state,
        nonce,
        code_challenge:        pkceChallenge(pkceVerifier),
        code_challenge_method: 'S256',
        // `prompt=select_account` so a user with multiple Google accounts
        // can choose which one to sign in with rather than getting
        // silently logged in as the most-recent.
        prompt:                'select_account',
        access_type:           'online',
      });
      return `${AUTH_URL}?${params.toString()}`;
    },

    async exchangeCode({ code, pkceVerifier, redirectUri }): Promise<OAuthTokens> {
      const body = new URLSearchParams({
        client_id:     config.clientId,
        client_secret: config.clientSecret,
        code,
        code_verifier: pkceVerifier,
        grant_type:    'authorization_code',
        redirect_uri:  redirectUri,
      });

      const res = await fetch(TOKEN_URL, {
        method:  'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        // 5 s timeout — provider outage shouldn't be an indefinite hang.
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Google token exchange failed (${res.status}): ${text.slice(0, 200)}`);
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
      });
      const res = await fetch(TOKEN_URL, {
        method:  'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal:  AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Google token refresh failed (${res.status}): ${text.slice(0, 200)}`);
      }
      const json = await res.json() as {
        access_token: string;
        refresh_token?: string;
        id_token?:     string;
        expires_in?:   number;
      };
      return {
        accessToken:  json.access_token,
        // Google's refresh response usually omits refresh_token (the old
        // one is still valid). UpsertTokens preserves the column on NULL.
        refreshToken: json.refresh_token ?? null,
        idToken:      json.id_token ?? null,
        expiresAt:    json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null,
      };
    },

    async fetchUserInfo(accessToken: string): Promise<OAuthUserInfo> {
      const res = await fetch(USERINFO_URL, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal:  AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        throw new Error(`Google userinfo failed: ${res.status}`);
      }
      const json = await res.json() as {
        sub:             string;
        email?:          string;
        email_verified?: boolean;
        name?:           string;
        picture?:        string;
      };
      return {
        subject:       json.sub,
        email:         json.email ?? null,
        emailVerified: json.email_verified === true,
        name:          json.name ?? null,
        avatarUrl:     json.picture ?? null,
      };
    },
  };
}
