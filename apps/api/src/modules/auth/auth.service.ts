import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'crypto';
import { AuthRepository } from './auth.repository.js';
import type { User } from '@projectflow/types';
import { JWT_SECRET } from '../../shared/lib/jwtSecret.js';

const REFRESH_TOKEN_EXPIRY_MS  = 7 * 24 * 60 * 60 * 1000; // 7 days
const PASSWORD_RESET_EXPIRY_MS = 60 * 60 * 1000;           // 1 hour

// ── Security constants (per security plan) ───────────────────────────────────
const BCRYPT_ROUNDS    = 12;  // cost factor 12 as per spec
const MAX_LOGIN_FAILS  = 5;   // lock after 5 consecutive failures
const LOCKOUT_MS       = 15 * 60 * 1000; // 15-minute lockout

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

  async login(
    email: string,
    passwordPlain: string,
  ): Promise<{ user: Partial<User>; accessToken: string; refreshToken: string } | 'locked' | null> {
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

    // ── Successful login: clear lockout state ────────────────────────────────
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
    return { user: userSafe, accessToken, refreshToken: raw };
  }

  async getMe(userId: string): Promise<Partial<User> | null> {
    return this.repo.getUserById(userId);
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
