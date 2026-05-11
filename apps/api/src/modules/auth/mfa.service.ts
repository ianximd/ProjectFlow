/**
 * MFA service — TOTP (RFC 6238) + recovery codes.
 *
 * Library: `otplib` for the TOTP primitives. We use the default 30-second
 * window with a ±1-step tolerance to handle clock drift on the user's device.
 *
 * Recovery codes: 10 single-use codes per enrolment, each 10 chars in the
 * `XXXX-XXXX-XX` format (alphanumeric, no ambiguous I/O/0/1). Stored as bcrypt
 * hashes (cost 12, same as passwords). Verified via linear scan over the small
 * per-user set — fine even at the worst case of 10 hashes × 1 bcrypt compare
 * per challenge.
 */

import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { generateSecret, generateURI, verifySync } from 'otplib';

const RECOVERY_CODE_COUNT  = 10;
const RECOVERY_CODE_BCRYPT = 12;
const TOTP_ISSUER = 'ProjectFlow';

// otplib v13 defaults are 30s window, 6 digits — what authenticator apps
// (Google Authenticator, 1Password, Authy, …) expect. epochTolerance=1 accepts
// the previous and next 30-second slot to forgive small clock drift.
const TOTP_EPOCH_TOLERANCE = 1;

// Ambiguous characters omitted: 0 / O / 1 / I / l.
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(length = 10): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += RECOVERY_ALPHABET[bytes[i]! % RECOVERY_ALPHABET.length];
  }
  // Insert a dash for readability — XXXX-XXXX-XX
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`;
}

export const mfaService = {
  /** Generate a new base32 TOTP secret. */
  generateSecret(): string {
    return generateSecret();
  },

  /**
   * Build the otpauth:// URI an authenticator app QR-encodes. The app accepts
   * the email as the account name and the issuer (shown above the code) as
   * the human-readable label.
   */
  otpauthUri(email: string, secret: string): string {
    return generateURI({ issuer: TOTP_ISSUER, label: email, secret });
  },

  /** Constant-time TOTP verification. Tolerates ±1 step of clock drift. */
  verifyTotp(code: string, secret: string): boolean {
    if (!code || !secret) return false;
    try {
      const result = verifySync({
        token: code.replace(/\s+/g, ''),
        secret,
        epochTolerance: TOTP_EPOCH_TOLERANCE,
      });
      return Boolean(result?.valid);
    } catch {
      return false;
    }
  },

  /**
   * Generate a fresh batch of recovery codes. Returns the plaintext codes
   * (shown to the user once) and their bcrypt hashes (persisted).
   */
  async generateRecoveryCodes(): Promise<{ plaintext: string[]; hashes: string[] }> {
    const plaintext: string[] = [];
    const hashes:    string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
      const code = randomCode();
      plaintext.push(code);
      hashes.push(await bcrypt.hash(code, RECOVERY_CODE_BCRYPT));
    }
    return { plaintext, hashes };
  },

  /**
   * Find a matching recovery code from a list of (id, hash) pairs. Returns
   * the matching id so the caller can delete it. Constant-time per comparison
   * (bcrypt.compare).
   */
  async findRecoveryCodeId(
    submitted: string,
    hashes: { id: string; hash: string }[],
  ): Promise<string | null> {
    const normalised = submitted.replace(/\s+/g, '').toUpperCase();
    for (const { id, hash } of hashes) {
      if (await bcrypt.compare(normalised, hash)) return id;
    }
    return null;
  },
};
