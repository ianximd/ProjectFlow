/**
 * Thin wrapper around the in-process Hono app for integration tests.
 *
 * Hono's built-in `app.request(path, init)` runs the full middleware
 * stack and returns a real `Response` — no HTTP listener, no supertest
 * dependency. The app is gated on `NODE_ENV !== 'test'` (server.ts) so
 * importing it here doesn't start workers, listeners, or MinIO.
 */

import { app } from '../../server.js';

interface RequestInit_ extends RequestInit {
  /** When set, sent as `Authorization: Bearer <token>`. */
  token?: string;
  /** Convenience: serializes to JSON and sets Content-Type. */
  json?: unknown;
}

/**
 * Issue an in-process request to the Hono app.
 * Always prefixes `/api/v1` so callers pass the route-relative path.
 */
export async function request(path: string, init: RequestInit_ = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);

  let body: BodyInit | null | undefined = init.body;
  if (init.json !== undefined) {
    body = JSON.stringify(init.json);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  }

  const url = `http://localhost/api/v1${path.startsWith('/') ? path : `/${path}`}`;
  return app.request(url, { ...init, headers, body });
}

/** Convenience: parse a Response as JSON, asserting status when given. */
export async function json<T = unknown>(res: Response, expectStatus?: number): Promise<T> {
  if (expectStatus !== undefined && res.status !== expectStatus) {
    const body = await res.text();
    throw new Error(`Expected ${expectStatus} but got ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

export { app };
