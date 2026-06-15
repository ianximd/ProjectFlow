/**
 * Phase 9e — Embed URL validator.
 *
 * Accepts only http: and https: URLs; rejects javascript:, data:, file:,
 * blob:, ftp:, and any string that is not a parseable URL. Strips URL
 * fragments before returning the normalised URL string.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export class EmbedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbedUrlError';
  }
}

/**
 * Validate and normalise an embed URL.
 *
 * - Must be a valid URL parseable by the WHATWG URL API.
 * - Protocol must be http: or https:.
 * - URL fragment (#…) is stripped from the returned string.
 *
 * @throws {EmbedUrlError} if the URL is invalid or uses a disallowed scheme.
 */
export function normalizeEmbedUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new EmbedUrlError(`Invalid embed URL: "${raw}" is not a valid URL`);
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new EmbedUrlError(
      `Disallowed embed URL scheme "${parsed.protocol}" — only http and https are permitted`,
    );
  }

  // Strip fragment; preserve origin + pathname + search
  parsed.hash = '';
  return parsed.toString();
}
