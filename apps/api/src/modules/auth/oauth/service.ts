/**
 * OAuth orchestrator. Glues:
 *   1. The provider abstraction (`getAuthorizationUrl`, `exchangeCode`,
 *      `fetchUserInfo`)
 *   2. The Redis state store (replay protection + PKCE verifier carry-over)
 *   3. The OAuth identity SPs (`getByProviderSubject` / `linkExisting` /
 *      `createUserWithIdentity`)
 *   4. `AuthService.issueSessionTokens` for the final refresh + access pair
 *
 * Phase 1.A scope: anonymous sign-in (existing identity → tokens, OR new
 * identity + new email → create user + identity + tokens). The link flow
 * (logged-in user adding a provider) and the email-collision auto-link
 * branch ship in Phase 1.C.
 */

import { OAuthRepository } from './repository.js';
import { AuthRepository }  from '../auth.repository.js';
import { AuthService }     from '../auth.service.js';
import { getProvider, callbackUrl } from './registry.js';
import {
  writeState,
  consumeState,
  makeRandomToken,
  type OAuthStatePayload,
} from './state.js';

import type { User } from '@projectflow/types';

export type OAuthCallbackResult =
  | { kind: 'tokens';    user: Partial<User>; accessToken: string; refreshToken: string }
  | { kind: 'error';     reason: 'INVALID_STATE' | 'PROVIDER_ERROR' | 'NO_EMAIL' | 'ACCOUNT_EXISTS'; message: string };

const RETURN_TO_ALLOW = /^\/[\w\-/?=&.#]*$/;

function safeReturnTo(input: string | undefined): string {
  if (!input) return '/board';
  if (!RETURN_TO_ALLOW.test(input)) return '/board';
  return input;
}

export class OAuthService {
  private repo:        OAuthRepository;
  private authRepo:    AuthRepository;
  private authService: AuthService;

  constructor(deps: { repo?: OAuthRepository; authRepo?: AuthRepository; authService?: AuthService } = {}) {
    this.repo        = deps.repo        ?? new OAuthRepository();
    this.authRepo    = deps.authRepo    ?? new AuthRepository();
    this.authService = deps.authService ?? new AuthService(this.authRepo);
  }

  /**
   * Build the provider's authorization URL and persist the matching state
   * payload to Redis. The browser is then 302'd to the returned URL.
   */
  async start(input: { provider: string; returnTo?: string }): Promise<{ url: string } | { error: 'UNKNOWN_PROVIDER' }> {
    const provider = getProvider(input.provider);
    if (!provider) return { error: 'UNKNOWN_PROVIDER' };

    const nonce        = makeRandomToken(16);
    const pkceVerifier = makeRandomToken(48);
    const state        = await writeState({
      provider:     provider.name,
      nonce,
      pkceVerifier,
      returnTo:     safeReturnTo(input.returnTo),
    });

    const url = provider.getAuthorizationUrl({
      state,
      nonce,
      pkceVerifier,
      redirectUri: callbackUrl(provider.name),
    });

    return { url };
  }

  /**
   * Handle the provider's callback. Consumes the state token (one-time —
   * second use returns INVALID_STATE), exchanges the code for tokens,
   * fetches user info, and resolves to either an existing user or a new
   * one. On success returns a token bundle the route handler can hand
   * off to `setRefreshCookie` + redirect to /oauth/finish.
   */
  async callback(input: { provider: string; code: string; state: string }): Promise<OAuthCallbackResult & { returnTo?: string }> {
    const provider = getProvider(input.provider);
    if (!provider) {
      return { kind: 'error', reason: 'INVALID_STATE', message: 'Unknown provider' };
    }

    const payload: OAuthStatePayload | null = await consumeState(input.state);
    if (!payload || payload.provider !== input.provider) {
      return { kind: 'error', reason: 'INVALID_STATE', message: 'State mismatch or expired' };
    }

    let tokens, info;
    try {
      tokens = await provider.exchangeCode({
        code:         input.code,
        pkceVerifier: payload.pkceVerifier,
        redirectUri:  callbackUrl(provider.name),
      });
      info = await provider.fetchUserInfo(tokens.accessToken);
    } catch (err) {
      return {
        kind:    'error',
        reason:  'PROVIDER_ERROR',
        message: (err as Error).message ?? 'Provider request failed',
      };
    }

    if (!info.email) {
      return {
        kind:    'error',
        reason:  'NO_EMAIL',
        message: `${provider.name} did not return an email — make a verified email visible and retry.`,
      };
    }

    // Existing identity → log in directly.
    const existing = await this.repo.findByProviderSubject(provider.name, info.subject);
    if (existing) {
      const user = await this.authRepo.getUserById(existing.UserId);
      if (!user) {
        return { kind: 'error', reason: 'INVALID_STATE', message: 'Linked user no longer exists' };
      }
      const session = await this.authService.issueSessionTokens(user);
      return { ...session, returnTo: payload.returnTo };
    }

    // No existing identity. Phase 1.A: refuse if the email collides with
    // an existing local account — the safe-link path is Phase 1.C. Until
    // then, the user must sign in with their password and link from
    // settings (also Phase 1.C; for now they'd contact support).
    const collision = await this.authRepo.getUserByEmail(info.email);
    if (collision) {
      return {
        kind:    'error',
        reason:  'ACCOUNT_EXISTS',
        message: `An account with ${info.email} already exists. Sign in with your password.`,
      };
    }

    const newUser = await this.repo.createUserWithIdentity({
      email:         info.email,
      name:          info.name ?? info.email.split('@')[0]!,
      avatarUrl:     info.avatarUrl,
      emailVerified: info.emailVerified,
      provider:      provider.name,
      subject:       info.subject,
    });

    const session = await this.authService.issueSessionTokens(newUser);
    return { ...session, returnTo: payload.returnTo };
  }
}
