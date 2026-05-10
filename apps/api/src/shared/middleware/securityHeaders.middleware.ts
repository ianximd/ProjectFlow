/**
 * Security headers middleware — OWASP-recommended HTTP response headers.
 *
 * Applied globally in server.ts BEFORE all route handlers so every response
 * (including 4xx/5xx) carries the hardening headers.
 *
 * Header decisions:
 *  - HSTS: 1 year, includeSubDomains — enforced by Nginx in production too,
 *           but belt-and-suspenders from the app layer is fine.
 *  - CSP:  restrictive default-src 'self'; scripts/styles extended only for
 *           Next.js app router needs (served from same origin in production).
 *  - COEP: require-corp is omitted because SharedArrayBuffer is not used and
 *           it breaks some third-party embeds (Stripe, Intercom, etc.)
 *  - X-Powered-By is removed (prevents server fingerprinting).
 */

import type { Context, Next } from 'hono';

const isProduction = process.env.NODE_ENV === 'production';

// Content-Security-Policy value (tightened for production)
const CSP = [
  "default-src 'self'",
  // Allow inline styles only in dev (Next.js HMR needs them)
  isProduction ? "style-src 'self'" : "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' wss:",   // WebSocket for real-time notifications
  "media-src 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",    // equivalent to X-Frame-Options: DENY
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join('; ');

export async function securityHeaders(c: Context, next: Next): Promise<void> {
  await next();

  // ── Transport security ───────────────────────────────────────────────────
  if (isProduction) {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // ── Framing / content-type sniffing ─────────────────────────────────────
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Content-Type-Options', 'nosniff');

  // ── Referrer / permissions ───────────────────────────────────────────────
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

  // ── Cross-Origin policies ────────────────────────────────────────────────
  c.header('Cross-Origin-Opener-Policy', 'same-origin');
  c.header('Cross-Origin-Resource-Policy', 'same-origin');

  // ── Content Security Policy ──────────────────────────────────────────────
  c.header('Content-Security-Policy', CSP);

  // ── Remove server-fingerprinting headers ────────────────────────────────
  c.res.headers.delete('X-Powered-By');
  c.res.headers.delete('Server');
}
