/**
 * Per-provider abstraction for OAuth 2.0 + OIDC sign-in.
 *
 * The shape is intentionally small: each provider supplies the URL it
 * wants the browser sent to (`getAuthorizationUrl`) and the two server-
 * side calls needed to translate a callback `code` into a stable user
 * identity (`exchangeCode` then `fetchUserInfo`).
 *
 * Adding a fourth provider (GitLab / Okta / etc.) is one new file in
 * `providers/` plus one entry in `oauth.registry.ts`.
 */

export type OAuthProviderName = 'google' | 'github' | 'microsoft' | 'fake';

export interface OAuthAuthorizationUrlInput {
  state:         string; // CSRF + replay-protection token (one-time use, Redis-backed)
  nonce:         string; // OIDC replay protection
  pkceVerifier:  string; // PKCE code_verifier — provider receives the SHA-256 challenge
  redirectUri:   string; // The absolute callback URL we registered with the provider
}

export interface OAuthTokens {
  accessToken:     string;
  refreshToken?:   string | null;
  idToken?:        string | null;
  expiresAt?:      Date | null;
}

/**
 * Stable per-user identity returned by the provider's userinfo endpoint.
 * `subject` MUST be the provider's stable identifier (Google `sub`,
 * Microsoft `oid` — NOT `sub`, which is tenant-scoped on `common`,
 * GitHub `id`). Email may be null when the user has hidden it.
 */
export interface OAuthUserInfo {
  subject:        string;
  email:          string | null;
  emailVerified:  boolean;
  name:           string | null;
  avatarUrl:      string | null;
}

export interface OAuthProvider {
  readonly name: OAuthProviderName;

  /** Compose the provider's authorization URL the browser should be sent to. */
  getAuthorizationUrl(input: OAuthAuthorizationUrlInput): string;

  /** POST to the provider's token endpoint with the callback `code`. */
  exchangeCode(input: {
    code:         string;
    pkceVerifier: string;
    redirectUri:  string;
  }): Promise<OAuthTokens>;

  /** GET the provider's userinfo endpoint and normalise the result. */
  fetchUserInfo(accessToken: string): Promise<OAuthUserInfo>;
}
