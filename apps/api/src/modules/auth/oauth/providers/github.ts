import type { OAuthProvider, OAuthAuthorizationUrlInput, OAuthTokens, OAuthUserInfo } from '../types.js';

/**
 * GitHub OAuth (OAuth Apps, not GitHub Apps).
 *
 * Two notable departures from the Google flow:
 *
 * 1. **No PKCE.** GitHub OAuth Apps don't formally support PKCE; the
 *    authorization endpoint silently ignores `code_challenge`. We omit
 *    it rather than send dead params. The flow is still safe because
 *    GitHub OAuth Apps are confidential clients (the secret is held
 *    server-side and never exposed).
 *
 * 2. **Email fallback.** `/user` returns `email: null` when the user
 *    has set their primary email to private. We then call `/user/emails`
 *    (requires the `user:email` scope) and pick the primary verified
 *    address. If neither yields an email, the orchestrator surfaces
 *    NO_EMAIL and the user is sent to /oauth/error?reason=NO_EMAIL with
 *    a hint to make a verified email visible.
 *
 * Subject is GitHub's numeric user `id`, stable across renames.
 */

const AUTH_URL     = 'https://github.com/login/oauth/authorize';
const TOKEN_URL    = 'https://github.com/login/oauth/access_token';
const USER_URL     = 'https://api.github.com/user';
const EMAILS_URL   = 'https://api.github.com/user/emails';

const SCOPES = ['read:user', 'user:email'];

export interface GitHubProviderConfig {
  clientId:     string;
  clientSecret: string;
}

export function createGitHubProvider(config: GitHubProviderConfig): OAuthProvider {
  return {
    name: 'github',

    getAuthorizationUrl({ state, redirectUri }: OAuthAuthorizationUrlInput): string {
      const params = new URLSearchParams({
        client_id:    config.clientId,
        redirect_uri: redirectUri,
        scope:        SCOPES.join(' '),
        state,
        // `allow_signup=true` is the GitHub default — omitting it keeps
        // the consent screen showing the "Create an account" link, which
        // matches the user's expectation of a sign-in flow.
      });
      return `${AUTH_URL}?${params.toString()}`;
    },

    async exchangeCode({ code, redirectUri }): Promise<OAuthTokens> {
      const body = new URLSearchParams({
        client_id:     config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri:  redirectUri,
      });

      const res = await fetch(TOKEN_URL, {
        method:  'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          // GitHub returns form-encoded by default; ask for JSON so we
          // don't have to parse `access_token=...&...` ourselves.
          'accept':       'application/json',
        },
        body,
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`GitHub token exchange failed (${res.status}): ${text.slice(0, 200)}`);
      }
      const json = await res.json() as {
        access_token?: string;
        token_type?:   string;
        scope?:        string;
        error?:        string;
      };
      if (!json.access_token) {
        // GitHub returns 200 with `error` in the body on bad codes.
        throw new Error(`GitHub token exchange returned no access_token: ${json.error ?? 'unknown'}`);
      }
      return {
        accessToken:  json.access_token,
        refreshToken: null,
        idToken:      null,
        expiresAt:    null,
      };
    },

    async fetchUserInfo(accessToken: string): Promise<OAuthUserInfo> {
      const headers = {
        authorization: `Bearer ${accessToken}`,
        accept:        'application/vnd.github+json',
        'user-agent':  'ProjectFlow-OAuth',
      };

      const userRes = await fetch(USER_URL, { headers, signal: AbortSignal.timeout(5_000) });
      if (!userRes.ok) throw new Error(`GitHub /user failed: ${userRes.status}`);
      const user = await userRes.json() as {
        id:         number;
        login:      string;
        name:       string | null;
        email:      string | null;
        avatar_url: string | null;
      };

      let email = user.email;
      let emailVerified = false;

      // /user.email is null when the user keeps their primary address
      // private. /user/emails returns the verified-email list when the
      // `user:email` scope is granted.
      if (!email) {
        const emailsRes = await fetch(EMAILS_URL, { headers, signal: AbortSignal.timeout(5_000) });
        if (emailsRes.ok) {
          const list = await emailsRes.json() as Array<{
            email:    string;
            primary:  boolean;
            verified: boolean;
          }>;
          const primary = list.find((e) => e.primary && e.verified)
            ?? list.find((e) => e.verified);
          if (primary) {
            email = primary.email;
            emailVerified = true;
          }
        }
      } else {
        // /user.email returned an address — GitHub only fills this
        // field when the user has set a verified primary as visible.
        emailVerified = true;
      }

      return {
        subject:   String(user.id), // numeric id stringified for the NVARCHAR column
        email,
        emailVerified,
        name:      user.name ?? user.login ?? null,
        avatarUrl: user.avatar_url,
      };
    },
  };
}
