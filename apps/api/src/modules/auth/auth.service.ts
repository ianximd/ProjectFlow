import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'crypto';
import { AuthRepository } from './auth.repository.js';
import { mfaService } from './mfa.service.js';
import type { User } from '@projectflow/types';
import { JWT_SECRET } from '../../shared/lib/jwtSecret.js';

const REFRESH_TOKEN_EXPIRY_MS  = 7 * 24 * 60 * 60 * 1000; // 7 days
const PASSWORD_RESET_EXPIRY_MS = 60 * 60 * 1000;           // 1 hour
const MFA_CHALLENGE_EXPIRY_S   = 5 * 60;                   // 5 minutes

// ── Security constants (per security plan) ───────────────────────────────────
const BCRYPT_ROUNDS    = 12;  // cost factor 12 as per spec
const MAX_LOGIN_FAILS  = 5;   // lock after 5 consecutive failures
const LOCKOUT_MS       = 15 * 60 * 1000; // 15-minute lockout

// ── MFA challenge token shape (separate JWT purpose) ─────────────────────────
interface MfaChallengePayload {
  purpose: 'mfa-challenge';
  userId: string;
  email: string;
}

export type LoginResult =
  | 'locked'
  | null
  | { kind: 'tokens';       user: Partial<User>; accessToken: string; refreshToken: string }
  | { kind: 'mfa-required'; mfaToken: string };

function generateSecureToken(): { raw: string; hash: string } {
  const raw = randomBytes(40).toString('hex');
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

export class AuthService {
  constructor(private repo: AuthRepository) {}

  async register(email: string, name: string, passwordPlain: string): Promise<User> {
    const hash = await bcrypt.hash(passwordPlain, BCRYPT_ROUNDS);
    return this.repo.createUser(email, name, hash);
  }

  async login(email: string, passwordPlain: string): Promise<LoginResult> {
    const user = await this.repo.getUserByEmail(email);
    if (!user || !(user as any).PasswordHash) return null;

    const userId = (user as any).Id as string;

    // ── Account lockout check ────────────────────────────────────────────────
    const lockedUntil: Date | null = (user as any).LockedUntil ?? null;
    if (lockedUntil && new Date(lockedUntil) > new Date()) {
      return 'locked';
    }

    // ── Password verification ─────────────────────────────────────────────────
    const isValid = await bcrypt.compare(passwordPlain, (user as any).PasswordHash);
    if (!isValid) {
      // Record failure — SP enforces MAX_LOGIN_FAILS threshold
      await this.repo.recordFailedLogin(userId);
      return null;
    }

    // ── MFA gate ─────────────────────────────────────────────────────────────
    // If the user has TOTP enabled, the password check is only step one. We
    // *don't* clear failed-login attempts yet — that happens after a successful
    // mfaChallenge. Issuing a short-lived "MFA challenge" JWT prevents the
    // client from having to re-send the password with the TOTP code.
    if ((user as any).MfaEnabled) {
      return {
        kind:     'mfa-required',
        mfaToken: this.mintMfaChallengeToken(userId, (user as any).Email),
      };
    }

    // ── Successful login (no MFA): clear lockout state + issue tokens ────────
    return this.issueSessionTokens(user);
  }

  /**
   * Step two of MFA login: validate the TOTP code (or recovery code) against
   * the short-lived mfa-challenge JWT and, on success, issue real session
   * tokens. Used by POST /auth/mfa/challenge.
   */
  async mfaChallenge(
    mfaToken: string,
    submitted: { code?: string; recoveryCode?: string },
  ): Promise<{ user: Partial<User>; accessToken: string; refreshToken: string } | 'invalid-token' | 'invalid-code'> {
    let payload: MfaChallengePayload;
    try {
      payload = jwt.verify(mfaToken, JWT_SECRET) as MfaChallengePayload;
    } catch {
      return 'invalid-token';
    }
    if (payload?.purpose !== 'mfa-challenge' || !payload.userId) return 'invalid-token';

    const state = await this.repo.getMfaState(payload.userId);
    if (!state?.enabled || !state.secret) return 'invalid-token';

    // Either a 6-digit TOTP or a recovery code is acceptable.
    let ok = false;
    if (submitted.code) {
      ok = mfaService.verifyTotp(submitted.code, state.secret);
    } else if (submitted.recoveryCode) {
      const hashes = await this.repo.listRecoveryHashes(payload.userId);
      const matchedId = await mfaService.findRecoveryCodeId(submitted.recoveryCode, hashes);
      if (matchedId) {
        ok = await this.repo.consumeRecoveryCode(matchedId);
      }
    }
    if (!ok) return 'invalid-code';

    const user = await this.repo.getUserById(payload.userId);
    if (!user) return 'invalid-token';
    return this.issueSessionTokens(user);
  }

  /**
   * Mint the short-lived JWT that the client trades in at /auth/mfa/challenge
   * for a real session. Public so OAuth (Phase 1.F) can reuse the exact
   * same shape password+MFA login uses — keeping a single MFA verification
   * code-path means we don't risk the OAuth gate drifting from the
   * password gate.
   */
  mintMfaChallengeToken(userId: string, email: string): string {
    return jwt.sign(
      { purpose: 'mfa-challenge', userId, email } satisfies MfaChallengePayload,
      JWT_SECRET,
      { expiresIn: MFA_CHALLENGE_EXPIRY_S },
    );
  }

  /**
   * Issue access + refresh tokens for an authenticated user, clear any
   * lockout state, and strip sensitive fields from the returned user
   * record. Public so the OAuth callback path (oauth.service) can reuse
   * the exact same token-issuance code-path as password + MFA login —
   * `clearLoginAttempts` and `createRefreshToken` MUST fire identically
   * for every successful sign-in regardless of the second-factor branch.
   */
  async issueSessionTokens(
    user: User,
  ): Promise<{ kind: 'tokens'; user: Partial<User>; accessToken: string; refreshToken: string }> {
    const userId = (user as any).Id as string;
    await this.repo.clearLoginAttempts(userId);

    const accessToken = jwt.sign(
      { userId, email: (user as any).Email },
      JWT_SECRET,
      { expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as any },
    );

    const { raw, hash } = generateSecureToken();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);
    await this.repo.createRefreshToken(userId, hash, expiresAt);

    const { PasswordHash, MfaSecret, ...userSafe } = user as any;
    return { kind: 'tokens', user: userSafe, accessToken, refreshToken: raw };
  }

  // ── MFA enrolment ────────────────────────────────────────────────────────

  /** Generate a fresh secret + otpauth URI for the user. Doesn't enable MFA yet. */
  async setupMfa(userId: string, email: string): Promise<{ secret: string; otpauthUri: string }> {
    const secret = mfaService.generateSecret();
    await this.repo.setMfaPending(userId, secret);
    return { secret, otpauthUri: mfaService.otpauthUri(email, secret) };
  }

  /**
   * Verify the first TOTP code against the pending secret. On success, flip
   * MfaEnabled to 1 and issue a fresh batch of recovery codes.
   * Returns the plaintext recovery codes (shown to the user once).
   */
  async verifyMfaSetup(userId: string, code: string): Promise<{ recoveryCodes: string[] } | null> {
    const state = await this.repo.getMfaState(userId);
    if (!state?.secret) return null;
    if (!mfaService.verifyTotp(code, state.secret)) return null;

    const { plaintext, hashes } = await mfaService.generateRecoveryCodes();
    await this.repo.createRecoveryCodes(userId, hashes);
    await this.repo.enableMfa(userId);
    return { recoveryCodes: plaintext };
  }

  /**
   * Disable MFA. Requires the user's current password AND a valid TOTP/recovery
   * code so a stolen access token alone can't strip the second factor.
   */
  async disableMfa(
    userId: string,
    passwordPlain: string,
    submittedCode: string,
  ): Promise<'invalid-password' | 'invalid-code' | 'ok'> {
    const user = await this.repo.getUserById(userId);
    if (!user) return 'invalid-password';
    if (!(await bcrypt.compare(passwordPlain, (user as any).PasswordHash))) return 'invalid-password';

    const state = await this.repo.getMfaState(userId);
    if (!state?.enabled || !state.secret) return 'ok'; // Already disabled — idempotent

    let ok = mfaService.verifyTotp(submittedCode, state.secret);
    if (!ok) {
      // Allow a recovery code as the second factor too.
      const hashes = await this.repo.listRecoveryHashes(userId);
      const matched = await mfaService.findRecoveryCodeId(submittedCode, hashes);
      if (matched) ok = await this.repo.consumeRecoveryCode(matched);
    }
    if (!ok) return 'invalid-code';

    await this.repo.disableMfa(userId);
    return 'ok';
  }

  async getMe(userId: string): Promise<Partial<User> | null> {
    return this.repo.getUserById(userId);
  }

  async updateProfile(
    userId: string,
    fields: { name?: string; avatarUrl?: string | null },
  ): Promise<User | null> {
    return this.repo.updateProfile(userId, fields);
  }

  /**
   * Change password while signed in: requires the current password to verify.
   * Returns 'no-password' if the account has no PasswordHash (OAuth-only user)
   * — those callers must use the forgot-password flow to set an initial one.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<'ok' | 'no-user' | 'no-password' | 'invalid-current'> {
    const user = await this.repo.getUserById(userId);
    if (!user) return 'no-user';
    const currentHash = (user as any).PasswordHash;
    if (!currentHash) return 'no-password';
    const ok = await bcrypt.compare(currentPassword, currentHash);
    if (!ok) return 'invalid-current';
    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.repo.updatePassword(userId, newHash);
    return 'ok';
  }

  async refreshAccessToken(
    rawToken: string,
  ): Promise<{ accessToken: string; refreshToken: string } | null> {
    const oldHash = createHash('sha256').update(rawToken).digest('hex');

    const record = await this.repo.getRefreshToken(oldHash);
    if (!record || record.RevokedAt || new Date(record.ExpiresAt) < new Date()) return null;

    // Revoke consumed token (rotation — prevents replay)
    await this.repo.revokeRefreshToken(oldHash);

    const accessToken = jwt.sign(
      { userId: record.UserId },
      JWT_SECRET,
      { expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as any },
    );

    // Issue a fresh refresh token
    const { raw, hash } = generateSecureToken();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);
    await this.repo.createRefreshToken(record.UserId, hash, expiresAt);

    return { accessToken, refreshToken: raw };
  }

  /**
   * Initiates a password reset. Returns the raw reset token so the caller
   * can hand it off to the email service. In production, never expose this
   * token in the API response — only send it via email.
   */
  async forgotPassword(email: string): Promise<{ resetToken: string } | null> {
    const user = await this.repo.getUserByEmail(email);
    // Always return a generic response to avoid user enumeration
    if (!user) return null;

    const { raw, hash } = generateSecureToken();
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY_MS);
    await this.repo.createPasswordResetToken((user as any).Id, hash, expiresAt);

    return { resetToken: raw };
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<boolean> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    const result = await this.repo.consumePasswordResetToken(tokenHash, newHash);
    return result !== null;
  }
}
