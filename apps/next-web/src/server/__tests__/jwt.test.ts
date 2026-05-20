import { describe, it, expect } from 'vitest';
import { decodeJwt, isJwtExpired } from '../jwt';

// helper: build an unsigned JWT with the given payload
function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}

describe('decodeJwt', () => {
  it('returns claims for a well-formed token', () => {
    const t = makeJwt({ userId: 'u1', email: 'a@b.c', exp: 9999999999 });
    expect(decodeJwt(t)).toMatchObject({ userId: 'u1', email: 'a@b.c' });
  });
  it('returns null for empty / malformed input', () => {
    expect(decodeJwt(undefined)).toBeNull();
    expect(decodeJwt('not-a-jwt')).toBeNull();
  });
});

describe('isJwtExpired', () => {
  it('true when exp is in the past', () => {
    expect(isJwtExpired({ userId: 'u', exp: 1 })).toBe(true);
  });
  it('true when exp within the skew window', () => {
    const soon = Math.floor(Date.now() / 1000) + 10;
    expect(isJwtExpired({ userId: 'u', exp: soon }, 30)).toBe(true);
  });
  it('false when exp is comfortably in the future', () => {
    const later = Math.floor(Date.now() / 1000) + 3600;
    expect(isJwtExpired({ userId: 'u', exp: later }, 30)).toBe(false);
  });
  it('true when claims are null or exp missing', () => {
    expect(isJwtExpired(null)).toBe(true);
    expect(isJwtExpired({ userId: 'u' })).toBe(true);
  });
});
