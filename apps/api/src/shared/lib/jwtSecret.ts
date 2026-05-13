/**
 * Shared JWT secret — single source of truth.
 *
 * Validated once at module-load time (i.e. process startup).
 * Throws in production when the secret is missing or still uses the default
 * placeholder value, so a misconfigured deployment fails fast and loudly
 * instead of silently issuing or accepting insecure tokens.
 *
 * Import this constant anywhere a JWT needs to be signed or verified.
 */
import { subLogger } from './logger.js';

const log = subLogger('auth');

export const JWT_SECRET = (() => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === 'change-this-secret-in-production') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'JWT_SECRET env var is required in production and must not use the default value',
      );
    }
    log.warn('using default JWT_SECRET — set a strong secret in production');
    return secret || 'change-this-secret-in-production';
  }
  return secret;
})();
