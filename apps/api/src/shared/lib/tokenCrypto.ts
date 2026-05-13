/**
 * Authenticated encryption for OAuth provider tokens at rest (Phase 1.D).
 *
 * Algorithm: AES-256-GCM with a 96-bit random IV per record (NIST SP 800-38D
 * §8.2.1 RBG-based construction). 128-bit auth tag is the standard.
 *
 * Sealed format:  v1.<keyId>.<iv>.<tag>.<ciphertext>
 *   - v1               format version — bump if we change algorithm or framing
 *   - keyId            which key encrypted this row; up to 16 chars [A-Za-z0-9_]
 *   - iv,tag,cipher    base64url, no padding
 *
 * Why per-row keyId rather than a single "current" key id stored separately:
 * old rows must remain decryptable after rotation. Inlining the id makes
 * decryption self-describing — the rotation procedure (see
 * docs/runbooks/oauth-key-rotation.md) just adds a new key, flips PRIMARY,
 * and lets the old key linger until the rotation worker re-encrypts.
 *
 * Keys are loaded from env at first use:
 *   OAUTH_TOKEN_ENC_KEY_PRIMARY = v2          (id of the encrypt key)
 *   OAUTH_TOKEN_ENC_KEY_v1      = <b64 32 B>  (legacy — decrypt only)
 *   OAUTH_TOKEN_ENC_KEY_v2      = <b64 32 B>  (current — encrypt + decrypt)
 *
 * If OAUTH_TOKEN_ENC_KEY_PRIMARY is unset OR points to an absent key, the
 * module reports `isConfigured() === false` and `seal()` throws. Callers
 * (the OAuth service) skip persistence silently in that case so OSS
 * deployments without the env vars keep working — they just don't store
 * provider tokens.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const FORMAT_VERSION = 'v1';
const KEY_ID_RE      = /^[A-Za-z0-9_]{1,16}$/;
const KEY_LEN        = 32;  // AES-256
const IV_LEN         = 12;  // GCM standard
const TAG_LEN        = 16;  // 128-bit tag

interface Keyset {
  primary: string | null;
  keys:    Map<string, Buffer>;
}

let cached: Keyset | null = null;

function loadKeyset(): Keyset {
  if (cached) return cached;

  const keys: Map<string, Buffer> = new Map();
  const prefix = 'OAUTH_TOKEN_ENC_KEY_';
  for (const [name, raw] of Object.entries(process.env)) {
    if (!name.startsWith(prefix)) continue;
    if (name === `${prefix}PRIMARY`) continue;
    if (!raw) continue;
    const id = name.slice(prefix.length);
    if (!KEY_ID_RE.test(id)) {
      throw new Error(`tokenCrypto: invalid key id in env ${name} — must match ${KEY_ID_RE}`);
    }
    let buf: Buffer;
    try {
      buf = Buffer.from(raw, 'base64');
    } catch {
      throw new Error(`tokenCrypto: ${name} is not valid base64`);
    }
    if (buf.length !== KEY_LEN) {
      throw new Error(`tokenCrypto: ${name} must decode to ${KEY_LEN} bytes (got ${buf.length})`);
    }
    keys.set(id, buf);
  }

  const primary = process.env.OAUTH_TOKEN_ENC_KEY_PRIMARY?.trim() || null;
  if (primary && !keys.has(primary)) {
    throw new Error(
      `tokenCrypto: OAUTH_TOKEN_ENC_KEY_PRIMARY="${primary}" but no matching ${prefix}${primary} env var`,
    );
  }

  cached = { primary, keys };
  return cached;
}

export function isConfigured(): boolean {
  return loadKeyset().primary !== null;
}

/**
 * Test/dev only — reset the cached keyset so a test can swap env vars
 * between runs. Not exported to the rest of the app.
 */
export function _resetForTest(): void {
  cached = null;
}

/**
 * Encrypt with the current PRIMARY key. Throws if no primary is set —
 * callers must check `isConfigured()` first if they want soft behavior.
 */
export function seal(plaintext: string): { sealed: string; keyId: string } {
  const ks = loadKeyset();
  if (!ks.primary) {
    throw new Error('tokenCrypto: no primary key configured (set OAUTH_TOKEN_ENC_KEY_PRIMARY)');
  }
  const key = ks.keys.get(ks.primary)!;
  const iv  = randomBytes(IV_LEN);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();

  const sealed = [
    FORMAT_VERSION,
    ks.primary,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ct.toString('base64url'),
  ].join('.');

  return { sealed, keyId: ks.primary };
}

/**
 * Decrypt a sealed string using the key id embedded in it. Throws on:
 *   - bad framing (wrong version, wrong segment count, bad base64)
 *   - missing key (the encrypting key was rotated out before re-encrypt)
 *   - tampering / wrong key (auth tag fails)
 */
export function open(sealed: string): string {
  const parts = sealed.split('.');
  if (parts.length !== 5) {
    throw new Error('tokenCrypto: sealed string has wrong segment count');
  }
  const [version, keyId, ivB64, tagB64, ctB64] = parts;
  if (version !== FORMAT_VERSION) {
    throw new Error(`tokenCrypto: unknown format version ${version}`);
  }
  const ks  = loadKeyset();
  const key = ks.keys.get(keyId!);
  if (!key) {
    throw new Error(`tokenCrypto: key "${keyId}" not present in keyset — cannot decrypt`);
  }

  const iv  = Buffer.from(ivB64!,  'base64url');
  const tag = Buffer.from(tagB64!, 'base64url');
  const ct  = Buffer.from(ctB64!,  'base64url');
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
    throw new Error('tokenCrypto: malformed iv/tag length');
  }

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

/**
 * Diagnostics — returns the primary key id and the full set of ids the
 * process can decrypt with. Used by the admin "OAuth key health" endpoint
 * (future) and by the rotation runbook smoke checks.
 */
export function describeKeyset(): { primary: string | null; available: string[] } {
  const ks = loadKeyset();
  return {
    primary:   ks.primary,
    available: [...ks.keys.keys()].sort(),
  };
}
