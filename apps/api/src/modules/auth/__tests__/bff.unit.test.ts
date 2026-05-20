import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isTrustedBff } from '../bff.js';

describe('isTrustedBff', () => {
  const origSecret = process.env.BFF_SECRET;
  const origNodeEnv = process.env.NODE_ENV;
  beforeEach(() => { process.env.BFF_SECRET = 'shh'; });
  afterEach(() => {
    if (origSecret === undefined) delete process.env.BFF_SECRET; else process.env.BFF_SECRET = origSecret;
    if (origNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = origNodeEnv;
  });

  it('returns true when header matches the configured secret', () => {
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

  it('an explicit BFF_SECRET overrides the dev default', () => {
    // beforeEach set BFF_SECRET='shh' — the dev default must NOT apply.
    expect(isTrustedBff('devsecret')).toBe(false);
    expect(isTrustedBff('shh')).toBe(true);
  });

  it('falls back to the dev default when BFF_SECRET is unset outside production', () => {
    delete process.env.BFF_SECRET;
    process.env.NODE_ENV = 'development';
    expect(isTrustedBff('devsecret')).toBe(true);
  });

  it('does NOT fall back to any default in production', () => {
    delete process.env.BFF_SECRET;
    process.env.NODE_ENV = 'production';
    expect(isTrustedBff('devsecret')).toBe(false);
  });
});
