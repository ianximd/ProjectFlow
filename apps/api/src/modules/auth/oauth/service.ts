/**
 * OAuth orchestrator. Glues:
 *   1. The provider abstraction (`getAuthorizationUrl`, `exchangeCode`,
 *      `fetchUserInfo`)
 *   2. The Redis state store (replay protection + PKCE verifier carry-over)
 *   3. The OAuth identity SPs (`getByProviderSubject` / `linkExisting` /
 *      `createUserWithIdentity`)
 *   4. `AuthService.issueSessionTokens` for the final refresh + access pair
 *
 * Phase 1.A: anonymous sign-in (existing identity → tokens, new identity
 * + fresh email → create user, email collision → ACCOUNT_EXISTS).
 *
 * Phase 1.C adds:
 *   - Linking flow: `start({ linkUserId })` stamps the user's id into the
 *     state payload, and `callback` calls `linkExisting` instead of
 *     creating a user. Errors propagate as ALREADY_LINKED.
 *   - Email-collision auto-link: when the provider asserts email
 *     verification AND the existing local user already has a verified
 *     email AND the address matches, link instead of refusing. Both
 *     sides have proven email ownership.
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
import { isConfigured as cryptoConfigured, seal } from '../../../shared/lib/tokenCrypto.js';
import { subLogger } from '../../../shared/lib/logger.js';

import type { User } from '@projectflow/types';
import type { OAuthTokens } from './types.js';

const log = subLogger('oauth');

export type OAuthCallbackResult =
  | { kind: 'tokens';       user: Partial<User>; accessToken: string; refreshToken: string }
  | { kind: 'linked';       userId: string }
  | { kind: 'mfa-required'; userId: string; userEmail: string; mfaToken: string }
  | { kind: 'error';        reason: 'INVALID_STATE' | 'PROVIDER_ERROR' | 'NO_EMAIL' | 'ACCOUNT_EXISTS' | 'ALREADY_LINKED'; message: string };

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
   *
   * Pass `linkUserId` to mark this as a link flow — the callback will
   * attach the new identity to that user instead of creating a new one.
   * The route handler is responsible for verifying the user's session
   * before passing the id; the service trusts what it's given.
   */
  async start(input: {
    provider:    string;
    returnTo?:   string;
    linkUserId?: string | null;
  }): Promise<{ url: string } | { error: 'UNKNOWN_PROVIDER' }> {
    const provider = getProvider(input.provider);
    if (!provider) return { error: 'UNKNOWN_PROVIDER' };

    const nonce        = makeRandomToken(16);
    const pkceVerifier = makeRandomToken(48);
    const state        = await writeState({
      provider:     provider.name,
      nonce,
      pkceVerifier,
      returnTo:     safeReturnTo(input.returnTo),
      linkUserId:   input.linkUserId ?? null,
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

    // Capture for after we've resolved which path created/linked the row.
    // We persist tokens regardless of which branch we ended up in below.
    const persistTokens = () => this.persistEncryptedTokens(provider.name, info.subject, tokens);

    // ── Link flow ───────────────────────────────────────────────────────
    // The state payload carries linkUserId when the user clicked Connect
    // from settings. Attach the new identity to that user and return
    // `linked` — no new session tokens are issued (the user is already
    // signed in via the access-token they used to hit /link).
    if (payload.linkUserId) {
      try {
        await this.repo.linkExisting({
          userId:   payload.linkUserId,
          provider: provider.name,
          subject:  info.subject,
          email:    info.email,
        });
        await persistTokens();
        return { kind: 'linked', userId: payload.linkUserId, returnTo: payload.returnTo };
      } catch (err: any) {
        // 51030 — (Provider, Subject) is already linked to a DIFFERENT user.
        if (err?.number === 51030) {
          return {
            kind:    'error',
            reason:  'ALREADY_LINKED',
            message: `This ${provider.name} account is already linked to a different ProjectFlow user.`,
          };
        }
        return { kind: 'error', reason: 'PROVIDER_ERROR', message: (err as Error).message };
      }
    }

    // ── Anonymous sign-in flow ──────────────────────────────────────────
    // Existing identity → log in directly.
    const existing = await this.repo.findByProviderSubject(provider.name, info.subject);
    if (existing) {
      const user = await this.authRepo.getUserById(existing.UserId);
      if (!user) {
        return { kind: 'error', reason: 'INVALID_STATE', message: 'Linked user no longer exists' };
      }
      // Phase 1.F — MFA gate. If the local account has TOTP enabled, the
      // OAuth provider's auth alone isn't enough: we still need the
      // second factor before issuing a real session. Persisting the
      // provider tokens here is intentional even though the user
      // hasn't completed MFA — the worst an attacker can do without
      // MFA is keep some encrypted bytes warm in our DB; they still
      // cannot get a session, and the legitimate user benefits from
      // the cached tokens once they complete the challenge.
      const gate = this.maybeMfaGate(user, payload.returnTo);
      if (gate) {
        await persistTokens();
        return gate;
      }
      const session = await this.authService.issueSessionTokens(user);
      await persistTokens();
      return { ...session, returnTo: payload.returnTo };
    }

    // No existing identity. Check for email collision against an
    // existing local account.
    const collision = await this.authRepo.getUserByEmail(info.email);
    if (collision) {
      // Auto-link: BOTH sides have proven email ownership. The provider
      // asserts emailVerified, AND the local account has IsEmailVerified.
      // Safe to attach the new identity without a password challenge —
      // the user could prove either credential alone, and they match.
      const collisionVerified = (collision as any).IsEmailVerified === true
        || (collision as any).IsEmailVerified === 1;
      if (info.emailVerified && collisionVerified) {
        try {
          await this.repo.linkExisting({
            userId:   (collision as any).Id,
            provider: provider.name,
            subject:  info.subject,
            email:    info.email,
          });
          // Auto-link still has to honour the local user's MFA. Same
          // gate as the existing-identity path above — see comment there.
          const gate = this.maybeMfaGate(collision as User, payload.returnTo);
          if (gate) {
            await persistTokens();
            return gate;
          }
          const session = await this.authService.issueSessionTokens(collision as User);
          await persistTokens();
          return { ...session, returnTo: payload.returnTo };
        } catch (err: any) {
          // Race: someone else linked this (provider, subject) between
          // our findByProviderSubject above and the linkExisting here.
          // Fall through to ACCOUNT_EXISTS rather than guess.
          if (err?.number === 51030) {
            return {
              kind:    'error',
              reason:  'ALREADY_LINKED',
              message: `This ${provider.name} account is already linked to a different ProjectFlow user.`,
            };
          }
          return { kind: 'error', reason: 'PROVIDER_ERROR', message: (err as Error).message };
        }
      }

      // Either side unverified → refuse. The user must sign in with
      // their password and link from settings — that path also proves
      // ownership of the local account.
      return {
        kind:    'error',
        reason:  'ACCOUNT_EXISTS',
        message: `An account with ${info.email} already exists. Sign in with your password and link from settings.`,
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
    await persistTokens();
    return { ...session, returnTo: payload.returnTo };
  }

  /**
   * Phase 1.F — return an `mfa-required` callback result when the user
   * has TOTP enabled, otherwise null (caller proceeds with token
   * issuance). Single helper so the existing-identity and auto-link
   * paths can't drift in their MFA enforcement.
   *
   * Brand-new-user-via-OAuth doesn't call this — those users were just
   * created and CAN'T have MFA enabled. Skipping the call also avoids
   * the cost of a no-op JWT mint.
   */
  private maybeMfaGate(user: User, returnTo?: string):
    (OAuthCallbackResult & { returnTo?: string }) | null
  {
    const enabled = (user as any).MfaEnabled;
    if (enabled !== true && enabled !== 1) return null;
    const userId    = (user as any).Id    as string;
    const userEmail = (user as any).Email as string;
    return {
      kind:      'mfa-required',
      userId,
      userEmail,
      mfaToken:  this.authService.mintMfaChallengeToken(userId, userEmail),
      returnTo,
    };
  }

  /**
   * Phase 1.D — encrypt the access + refresh tokens we just exchanged and
   * stash them on the identity row. No-op when the deployment hasn't
   * configured an encryption key (back-compat with Phase 1.A/1.B).
   *
   * Fire-and-forget at the call sites for safety: a failure to persist
   * the long-lived refresh token is bad but it MUST NOT take down the
   * sign-in. The user gets their session; an admin gets a log line.
   */
  private async persistEncryptedTokens(provider: string, subject: string, tokens: OAuthTokens): Promise<void> {
    if (!cryptoConfigured()) return;
    try {
      const access  = seal(tokens.accessToken);
      const refresh = tokens.refreshToken ? seal(tokens.refreshToken) : null;
      await this.repo.upsertTokens({
        provider,
        subject,
        accessTokenEnc:  access.sealed,
        refreshTokenEnc: refresh?.sealed ?? null,
        tokenExpiresAt:  tokens.expiresAt ?? null,
        tokenKeyVersion: access.keyId,
      });
    } catch (err) {
      log.error({ provider, err: (err as Error).message }, 'failed to persist encrypted tokens');
    }
  }

  // ── Identity management (Phase 1.C) ────────────────────────────────────

  async listIdentitiesForUser(userId: string) {
    return this.repo.listForUser(userId);
  }

  /**
   * Unlink a provider from the user. Surfaces 51031 ("last credential")
   * as a typed result the route handler maps to 409.
   */
  async unlink(userId: string, provider: string): Promise<{ ok: true } | { ok: false; reason: 'LAST_CREDENTIAL' }> {
    try {
      await this.repo.unlink(userId, provider);
      return { ok: true };
    } catch (err: any) {
      if (err?.number === 51031) {
        return { ok: false, reason: 'LAST_CREDENTIAL' };
      }
      throw err;
    }
  }
}
