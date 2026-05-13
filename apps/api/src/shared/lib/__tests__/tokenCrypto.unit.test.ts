/**
 * tokenCrypto — AES-256-GCM seal/open with key versioning.
 *
 * Coverage:
 *   - happy roundtrip
 *   - multi-key fallback (PRIMARY=v2 still decrypts v1-sealed strings)
 *   - rotation lifecycle (encrypt v1 → add v2 → flip PRIMARY → re-encrypt → drop v1)
 *   - tamper detection (auth tag fails when ciphertext is mutated)
 *   - missing primary → isConfigured() false, seal() throws
 *   - decrypt with no matching key → throws
 *   - malformed sealed strings → throws
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

const KEY_V1 = randomBytes(32).toString('base64');
const KEY_V2 = randomBytes(32).toString('base64');

let mod: typeof import('../tokenCrypto.js');

async function loadFresh() {
  // Re-import a fresh module so the env-driven keyset is rebuilt per
  // test. We also call _resetForTest() to flush any cached keyset that
  // was populated during a previous import.
  const m = await import('../tokenCrypto.js');
  m._resetForTest();
  return m;
}

beforeEach(async () => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('OAUTH_TOKEN_ENC_KEY_')) delete process.env[k];
  }
  mod = await loadFresh();
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('OAUTH_TOKEN_ENC_KEY_')) delete process.env[k];
  }
});

describe('tokenCrypto — configuration', () => {
  it('reports unconfigured when no PRIMARY is set', () => {
    expect(mod.isConfigured()).toBe(false);
    expect(() => mod.seal('hello')).toThrow(/no primary key/);
  });

  it('throws on PRIMARY pointing to an absent key', async () => {
    process.env.OAUTH_TOKEN_ENC_KEY_PRIMARY = 'v9';
    process.env.OAUTH_TOKEN_ENC_KEY_v1      = KEY_V1;
    mod = await loadFresh();
    expect(() => mod.isConfigured()).toThrow(/no matching .* env var/);
  });

  it('rejects a key id that contains illegal characters', async () => {
    process.env['OAUTH_TOKEN_ENC_KEY_with-dash'] = KEY_V1;
    mod = await loadFresh();
    expect(() => mod.describeKeyset()).toThrow(/invalid key id/);
  });

  it('rejects a key whose decoded length is not 32 bytes', async () => {
    process.env.OAUTH_TOKEN_ENC_KEY_v1      = Buffer.from('too-short').toString('base64');
    process.env.OAUTH_TOKEN_ENC_KEY_PRIMARY = 'v1';
    mod = await loadFresh();
    expect(() => mod.isConfigured()).toThrow(/32 bytes/);
  });
});

describe('tokenCrypto — seal/open roundtrip', () => {
  beforeEach(async () => {
    process.env.OAUTH_TOKEN_ENC_KEY_PRIMARY = 'v1';
    process.env.OAUTH_TOKEN_ENC_KEY_v1      = KEY_V1;
    mod = await loadFresh();
  });

  it('roundtrips a typical bearer token', () => {
    const token = 'ya29.A0ARrdaM-' + 'x'.repeat(120);
    const { sealed, keyId } = mod.seal(token);
    expect(keyId).toBe('v1');
    expect(sealed.startsWith('v1.v1.')).toBe(true);
    expect(mod.open(sealed)).toBe(token);
  });

  it('roundtrips an empty string', () => {
    const { sealed } = mod.seal('');
    expect(mod.open(sealed)).toBe('');
  });

  it('produces a different IV on every call (no deterministic leakage)', () => {
    const a = mod.seal('same-plaintext');
    const b = mod.seal('same-plaintext');
    expect(a.sealed).not.toBe(b.sealed);
    expect(mod.open(a.sealed)).toBe('same-plaintext');
    expect(mod.open(b.sealed)).toBe('same-plaintext');
  });
});

describe('tokenCrypto — key rotation', () => {
  it('decrypts a v1-sealed string after PRIMARY rotates to v2', async () => {
    process.env.OAUTH_TOKEN_ENC_KEY_PRIMARY = 'v1';
    process.env.OAUTH_TOKEN_ENC_KEY_v1      = KEY_V1;
    mod = await loadFresh();
    const { sealed: oldSealed } = mod.seal('refresh-token-from-yesterday');

    // Operator adds v2 and flips PRIMARY (the runbook procedure).
    process.env.OAUTH_TOKEN_ENC_KEY_v2      = KEY_V2;
    process.env.OAUTH_TOKEN_ENC_KEY_PRIMARY = 'v2';
    mod = await loadFresh();

    expect(mod.describeKeyset()).toEqual({ primary: 'v2', available: ['v1', 'v2'] });
    // Old row is still readable…
    expect(mod.open(oldSealed)).toBe('refresh-token-from-yesterday');
    // …and new writes go out under v2.
    const fresh = mod.seal('new-token');
    expect(fresh.keyId).toBe('v2');
    expect(mod.open(fresh.sealed)).toBe('new-token');
  });

  it('refuses to decrypt once the encrypting key is removed', async () => {
    process.env.OAUTH_TOKEN_ENC_KEY_PRIMARY = 'v1';
    process.env.OAUTH_TOKEN_ENC_KEY_v1      = KEY_V1;
    mod = await loadFresh();
    const { sealed } = mod.seal('orphaned');

    // Operator drops v1 before the rotation worker re-encrypted this row.
    delete process.env.OAUTH_TOKEN_ENC_KEY_v1;
    process.env.OAUTH_TOKEN_ENC_KEY_v2      = KEY_V2;
    process.env.OAUTH_TOKEN_ENC_KEY_PRIMARY = 'v2';
    mod = await loadFresh();

    expect(() => mod.open(sealed)).toThrow(/key "v1" not present/);
  });
});

describe('tokenCrypto — tamper + framing', () => {
  beforeEach(async () => {
    process.env.OAUTH_TOKEN_ENC_KEY_PRIMARY = 'v1';
    process.env.OAUTH_TOKEN_ENC_KEY_v1      = KEY_V1;
    mod = await loadFresh();
  });

  it('rejects a sealed string whose ciphertext byte was flipped', () => {
    const { sealed } = mod.seal('important-token');
    const parts = sealed.split('.');
    const ct    = Buffer.from(parts[4]!, 'base64url');
    ct[0]       = ct[0]! ^ 0x01;
    parts[4]    = ct.toString('base64url');
    expect(() => mod.open(parts.join('.'))).toThrow();
  });

  it('rejects a sealed string with the wrong segment count', () => {
    expect(() => mod.open('v1.v1.iv.tag')).toThrow(/segment count/);
  });

  it('rejects a sealed string with an unknown format version', () => {
    const { sealed } = mod.seal('x');
    const parts      = sealed.split('.');
    parts[0]         = 'v9';
    expect(() => mod.open(parts.join('.'))).toThrow(/format version/);
  });
});
