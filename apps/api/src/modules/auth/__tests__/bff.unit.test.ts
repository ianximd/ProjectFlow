import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isTrustedBff } from '../bff.js';

describe('isTrustedBff', () => {
  const orig = process.env.BFF_SECRET;
  beforeEach(() => { process.env.BFF_SECRET = 'shh'; });
  afterEach(() => { process.env.BFF_SECRET = orig; });

  it('returns true when header matches the secret', () => {
    expect(isTrustedBff('shh')).toBe(true);
  });
  it('returns false when header is wrong', () => {
    expect(isTrustedBff('nope')).toBe(false);
  });
  it('returns false when header is missing', () => {
    expect(isTrustedBff(undefined)).toBe(false);
  });
  it('returns false when header is an empty string', () => {
    expect(isTrustedBff('')).toBe(false);
  });
  it('returns false when BFF_SECRET is unset', () => {
    delete process.env.BFF_SECRET;
    expect(isTrustedBff('shh')).toBe(false);
  });
});
