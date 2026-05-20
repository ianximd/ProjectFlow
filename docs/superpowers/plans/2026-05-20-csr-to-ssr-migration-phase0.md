# CSR → SSR Migration — Phase 0 (BFF Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the server-readable cookie session (BFF) + Data Access Layer + auth Server Actions + proxy refresh chokepoint, **without breaking the existing client app** — so later phases can migrate pages to RSC one at a time.

**Architecture:** Next.js becomes the auth boundary. Login/refresh go through Next (Server Actions + a `/api/auth/refresh` route handler) which stores the backend's access JWT + rotating refresh token in **httpOnly cookies at `path=/`** (`pf_at`, `pf_rt`). A `proxy.ts` refreshes the access token once per navigation. A DAL (`src/server/*`) reads the cookie for server fetches. The legacy in-memory token + react-query stay alive in parallel (the client's `AuthBootstrap` now rehydrates from the cookie session via `/api/auth/refresh`) and are removed in Phase 3.

**Tech Stack:** Next.js 16 (App Router, Proxy, async `cookies()`, Server Actions), React 19, Hono backend (`apps/api`), Vitest.

**Spec:** `docs/superpowers/specs/2026-05-20-csr-to-ssr-migration-design.md`
**Branch:** `feat/csr-to-ssr-migration`

---

## Scope

**In scope (Phase 0):** email/password + MFA BFF session, cookie helpers, DAL (`session`, `api`, `selection`), auth Server Actions, `/api/auth/refresh` route handler, `proxy.ts`, wiring `login`/`register`/`oauth/mfa` to actions, rehydrating `AuthBootstrap` from the cookie session, and the backend `X-BFF-Secret` change for `login` / `mfa/challenge` / `refresh`.

**Deferred to Phase 0.B (needs deeper exploration of `apps/api/src/modules/auth/oauth/*`):** OAuth one-time-code finish handler; refresh-token **rotation grace window** (needs a refresh-token-lineage schema change — the proxy single-chokepoint already removes the common intra-request race, so this is lower urgency).

**Deferred to later phases:** page → RSC migration, Server Actions for domain mutations, react-query removal, `AuthBootstrap` removal.

---

## File Structure

**Backend (`apps/api`)**
- Create `src/modules/auth/bff.ts` — `isTrustedBff()` trust check (one responsibility: secret comparison).
- Create `src/modules/auth/__tests__/bff.unit.test.ts` — unit test for the above.
- Modify `src/modules/auth/auth.routes.ts` — add `refreshToken` to `login` / `mfa/challenge` / `refresh` response bodies when the caller is a trusted BFF.

**Frontend (`apps/next-web`)**
- Create `src/server/jwt.ts` — decode JWT claims + expiry check (pure; no `server-only`).
- Create `src/server/auth-decision.ts` — pure proxy redirect decision (no `server-only`).
- Create `src/server/cookies.ts` — cookie names + set/clear helpers (`server-only`).
- Create `src/server/session.ts` — `getSession()` / `requireSession()` (`server-only`).
- Create `src/server/api.ts` — `serverFetch()` (`server-only`).
- Create `src/server/selection.ts` — `getSelection()` (`server-only`).
- Create `src/server/actions/selection.ts` — `setSelection()` Server Action.
- Create `src/server/actions/auth.ts` — `login` / `mfaChallenge` / `register` / `logout` Server Actions.
- Create `src/app/api/auth/refresh/route.ts` — route handler the client uses to rehydrate.
- Create `src/proxy.ts` — refresh chokepoint + optimistic redirects.
- Create `src/server/__tests__/jwt.test.ts`, `src/server/__tests__/auth-decision.test.ts`.
- Modify `src/app/login/page.tsx`, `src/app/register/page.tsx`, `src/app/oauth/mfa/page.tsx`, `src/app/(app)/auth-bootstrap.tsx`.
- Modify `.env.example`; developer adds to `.env.local`.

> Unit tests cover only the pure modules (`jwt`, `auth-decision`, `bff`); modules that `import 'server-only'` are verified by the manual end-to-end task (Task 16). This avoids `server-only` throwing under Vitest.

---

## Task 1: Backend — `X-BFF-Secret` trust + refresh token in body

**Files:**
- Create: `apps/api/src/modules/auth/bff.ts`
- Test: `apps/api/src/modules/auth/__tests__/bff.unit.test.ts`
- Modify: `apps/api/src/modules/auth/auth.routes.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/auth/__tests__/bff.unit.test.ts
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
  it('returns false when BFF_SECRET is unset', () => {
    delete process.env.BFF_SECRET;
    expect(isTrustedBff('shh')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/api && npx vitest run src/modules/auth/__tests__/bff.unit.test.ts`
Expected: FAIL — `Cannot find module '../bff.js'`.

- [ ] **Step 3: Implement the helper**

```ts
// apps/api/src/modules/auth/bff.ts
/**
 * Trusted server-to-server (BFF) caller check. The Next.js server sends the
 * shared secret in the X-BFF-Secret header so we can safely return the rotating
 * refresh token in the response body. Browsers never set this header and never
 * receive the token. Disabled (always false) unless BFF_SECRET is configured.
 */
export function isTrustedBff(headerValue: string | undefined | null): boolean {
  const expected = process.env.BFF_SECRET;
  if (!expected || !headerValue) return false;
  return headerValue === expected;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd apps/api && npx vitest run src/modules/auth/__tests__/bff.unit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the helper into the auth routes**

In `apps/api/src/modules/auth/auth.routes.ts`, add the import near the top (after the existing `./auth.middleware.js` import on line 5):

```ts
import { isTrustedBff } from './bff.js';
```

Replace the `login` success return (currently lines 86-87):

```ts
  // Refresh token is delivered via httpOnly cookie — never exposed to browsers.
  // Trusted BFF callers also get it in the body so Next can own the session.
  setRefreshCookie(c, result.refreshToken);
  const loginBody: any = { user: result.user, token: result.accessToken };
  if (isTrustedBff(c.req.header('X-BFF-Secret'))) loginBody.refreshToken = result.refreshToken;
  return c.json({ data: loginBody });
```

Replace the `mfa/challenge` success return (currently lines 101-102):

```ts
  setRefreshCookie(c, result.refreshToken);
  const mfaBody: any = { user: result.user, token: result.accessToken };
  if (isTrustedBff(c.req.header('X-BFF-Secret'))) mfaBody.refreshToken = result.refreshToken;
  return c.json({ data: mfaBody });
```

Replace the `refresh` success return (currently lines 255-256):

```ts
  setRefreshCookie(c, result.refreshToken);
  const refreshBody: any = { token: result.accessToken };
  if (isTrustedBff(c.req.header('X-BFF-Secret'))) refreshBody.refreshToken = result.refreshToken;
  return c.json({ data: refreshBody });
```

- [ ] **Step 6: Verify the routes still build + suite is green**

Run: `cd apps/api && npx vitest run src/modules/auth`
Expected: PASS — existing auth route/service tests plus the new `bff` test.

- [ ] **Step 7: Manual route check (with the dev API + DB running, a known user seeded)**

Run (replace email/password/secret with your dev values; set `BFF_SECRET=devsecret` in `apps/api/.env`):
```bash
curl -s -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" -H "X-BFF-Secret: devsecret" \
  -d '{"email":"you@example.com","password":"yourpassword"}'
```
Expected: JSON body contains `"token"` **and** `"refreshToken"`. Repeat without the `X-BFF-Secret` header → body has `"token"` but **no** `"refreshToken"`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/auth/bff.ts apps/api/src/modules/auth/__tests__/bff.unit.test.ts apps/api/src/modules/auth/auth.routes.ts
git commit -m "feat(api): return refresh token to trusted BFF (X-BFF-Secret)"
```

---

## Task 2: Frontend env vars

**Files:**
- Modify: `apps/next-web/.env.example`
- Modify (developer, not committed): `apps/next-web/.env.local`

- [ ] **Step 1: Add to `apps/next-web/.env.example`** (append after the existing `NEXT_PUBLIC_API_URL` block):

```bash
# ── BFF (server-to-server) ──────────────────────────────────────────────────────
# Base URL the Next SERVER uses to reach the API (no trailing slash). Usually the
# same host as NEXT_PUBLIC_API_URL in dev; an internal URL in prod.
API_INTERNAL_URL=http://localhost:3001
# Shared secret sent as X-BFF-Secret so the API returns the rotating refresh token
# to the trusted Next server. MUST match apps/api BFF_SECRET. Generate: openssl rand -hex 32
BFF_SECRET=devsecret
```

- [ ] **Step 2: Add the same two vars to `apps/next-web/.env.local`** with real values, and set `BFF_SECRET=devsecret` (matching value) in `apps/api/.env`.

- [ ] **Step 3: Commit**

```bash
git add apps/next-web/.env.example
git commit -m "chore(next-web): document BFF env vars"
```

---

## Task 3: JWT decode utility (pure, unit-tested)

**Files:**
- Create: `apps/next-web/src/server/jwt.ts`
- Test: `apps/next-web/src/server/__tests__/jwt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/next-web/src/server/__tests__/jwt.test.ts
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/next-web && npx vitest run src/server/__tests__/jwt.test.ts`
Expected: FAIL — cannot find `../jwt`.

- [ ] **Step 3: Implement**

```ts
// apps/next-web/src/server/jwt.ts
export interface JwtClaims {
  userId: string;
  email?: string;
  exp?: number; // seconds since epoch
  iat?: number;
}

/** Decode (NOT verify) a JWT payload. Signature is enforced by the API on every
 *  request; here we only need the claims for an optimistic expiry check. */
export function decodeJwt(token: string | undefined | null): JwtClaims | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as JwtClaims;
  } catch {
    return null;
  }
}

/** True if the token is missing `exp`, or expires within `skewSeconds`. */
export function isJwtExpired(claims: JwtClaims | null, skewSeconds = 30): boolean {
  if (!claims?.exp) return true;
  return claims.exp * 1000 <= Date.now() + skewSeconds * 1000;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd apps/next-web && npx vitest run src/server/__tests__/jwt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/next-web/src/server/jwt.ts apps/next-web/src/server/__tests__/jwt.test.ts
git commit -m "feat(next-web): add JWT decode/expiry util for the DAL"
```

---

## Task 4: Proxy auth-decision (pure, unit-tested)

**Files:**
- Create: `apps/next-web/src/server/auth-decision.ts`
- Test: `apps/next-web/src/server/__tests__/auth-decision.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/next-web/src/server/__tests__/auth-decision.test.ts
import { describe, it, expect } from 'vitest';
import { decideAuth } from '../auth-decision';

describe('decideAuth', () => {
  it('redirects unauthenticated users away from protected routes', () => {
    expect(decideAuth('/board', false)).toBe('redirect-login');
    expect(decideAuth('/projects', false)).toBe('redirect-login');
  });
  it('allows unauthenticated users on public routes', () => {
    expect(decideAuth('/login', false)).toBe('allow');
    expect(decideAuth('/register', false)).toBe('allow');
    expect(decideAuth('/oauth/finish', false)).toBe('allow');
    expect(decideAuth('/', false)).toBe('allow');
  });
  it('bounces authenticated users off login/register/root', () => {
    expect(decideAuth('/login', true)).toBe('redirect-app');
    expect(decideAuth('/register', true)).toBe('redirect-app');
    expect(decideAuth('/', true)).toBe('redirect-app');
  });
  it('allows authenticated users on protected routes', () => {
    expect(decideAuth('/board', true)).toBe('allow');
    expect(decideAuth('/oauth/mfa', true)).toBe('allow');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/next-web && npx vitest run src/server/__tests__/auth-decision.test.ts`
Expected: FAIL — cannot find `../auth-decision`.

- [ ] **Step 3: Implement**

```ts
// apps/next-web/src/server/auth-decision.ts
export type AuthDecision = 'allow' | 'redirect-login' | 'redirect-app';

// Routes reachable without a session. Everything else is protected.
const PUBLIC_EXACT = new Set(['/']);
const PUBLIC_PREFIXES = ['/login', '/register', '/oauth'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function decideAuth(pathname: string, isAuthed: boolean): AuthDecision {
  if (!isAuthed) return isPublic(pathname) ? 'allow' : 'redirect-login';
  if (pathname === '/login' || pathname === '/register' || pathname === '/') return 'redirect-app';
  return 'allow';
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd apps/next-web && npx vitest run src/server/__tests__/auth-decision.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/next-web/src/server/auth-decision.ts apps/next-web/src/server/__tests__/auth-decision.test.ts
git commit -m "feat(next-web): add pure proxy auth-decision"
```

---

## Task 5: Cookie helpers

**Files:**
- Create: `apps/next-web/src/server/cookies.ts`

- [ ] **Step 1: Implement**

```ts
// apps/next-web/src/server/cookies.ts
import 'server-only';
import { cookies } from 'next/headers';

export const COOKIE = {
  access: 'pf_at',
  refresh: 'pf_rt',
  selection: 'pf_sel',
} as const;

const isProd = process.env.NODE_ENV === 'production';

export const COOKIE_BASE = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax',
  path: '/',
} as const;

export const ACCESS_MAX_AGE = 15 * 60;            // ~JWT_EXPIRES_IN default (15m)
export const REFRESH_MAX_AGE = 7 * 24 * 60 * 60;  // 7 days
export const SELECTION_MAX_AGE = 180 * 24 * 60 * 60;

export async function setSessionCookies(accessToken: string, refreshToken: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE.access, accessToken, { ...COOKIE_BASE, maxAge: ACCESS_MAX_AGE });
  jar.set(COOKIE.refresh, refreshToken, { ...COOKIE_BASE, maxAge: REFRESH_MAX_AGE });
}

export async function clearSessionCookies(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE.access);
  jar.delete(COOKIE.refresh);
  jar.delete(COOKIE.selection);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/next-web && npx tsc --noEmit`
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add apps/next-web/src/server/cookies.ts
git commit -m "feat(next-web): add session cookie helpers"
```

---

## Task 6: Session DAL

**Files:**
- Create: `apps/next-web/src/server/session.ts`

- [ ] **Step 1: Implement**

```ts
// apps/next-web/src/server/session.ts
import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE } from './cookies';
import { decodeJwt, isJwtExpired, type JwtClaims } from './jwt';

/** Current session from the access-token cookie, or null. Deduped per render. */
export const getSession = cache(async (): Promise<JwtClaims | null> => {
  const token = (await cookies()).get(COOKIE.access)?.value;
  const claims = decodeJwt(token);
  // skew 0: the proxy already refreshed; treat a still-expired token as no session.
  if (!claims || isJwtExpired(claims, 0)) return null;
  return claims;
});

export async function requireSession(): Promise<JwtClaims> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/next-web && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/next-web/src/server/session.ts
git commit -m "feat(next-web): add getSession/requireSession DAL"
```

---

## Task 7: serverFetch DAL

**Files:**
- Create: `apps/next-web/src/server/api.ts`

- [ ] **Step 1: Implement**

```ts
// apps/next-web/src/server/api.ts
import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE } from './cookies';

const API_BASE =
  process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/**
 * Server-to-server fetch to the API, carrying the access token from the session
 * cookie. `path` is the part AFTER `/api/v1` (e.g. `/projects?workspaceId=x`).
 * Returns the unwrapped `data` field. Throws on non-OK; redirects to /login on 401.
 */
export async function serverFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = (await cookies()).get(COOKIE.access)?.value;
  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (res.status === 401) redirect('/login');
  if (res.status === 204) return undefined as T;

  const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { message?: string } };
  if (!res.ok) throw new Error(json?.error?.message ?? `Request failed (${res.status})`);
  return json.data as T;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/next-web && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/next-web/src/server/api.ts
git commit -m "feat(next-web): add serverFetch DAL"
```

---

## Task 8: Selection read + Server Action

**Files:**
- Create: `apps/next-web/src/server/selection.ts`
- Create: `apps/next-web/src/server/actions/selection.ts`

- [ ] **Step 1: Implement the reader**

```ts
// apps/next-web/src/server/selection.ts
import 'server-only';
import { cookies } from 'next/headers';
import { COOKIE } from './cookies';

export interface Selection {
  workspaceId: string | null;
  projectId: string | null;
}

export async function getSelection(): Promise<Selection> {
  const raw = (await cookies()).get(COOKIE.selection)?.value;
  if (!raw) return { workspaceId: null, projectId: null };
  try {
    const v = JSON.parse(raw) as Partial<Selection>;
    return { workspaceId: v.workspaceId ?? null, projectId: v.projectId ?? null };
  } catch {
    return { workspaceId: null, projectId: null };
  }
}
```

- [ ] **Step 2: Implement the Server Action**

```ts
// apps/next-web/src/server/actions/selection.ts
'use server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { COOKIE, COOKIE_BASE, SELECTION_MAX_AGE } from '../cookies';
import type { Selection } from '../selection';

export async function setSelection(input: Partial<Selection>): Promise<void> {
  const jar = await cookies();
  let current: Partial<Selection> = {};
  try { current = JSON.parse(jar.get(COOKIE.selection)?.value ?? '{}'); } catch { /* ignore */ }

  const next: Selection = {
    workspaceId: input.workspaceId !== undefined ? input.workspaceId : current.workspaceId ?? null,
    projectId:   input.projectId   !== undefined ? input.projectId   : current.projectId   ?? null,
  };

  jar.set(COOKIE.selection, JSON.stringify(next), { ...COOKIE_BASE, maxAge: SELECTION_MAX_AGE });
  revalidatePath('/', 'layout');
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/next-web && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/next-web/src/server/selection.ts apps/next-web/src/server/actions/selection.ts
git commit -m "feat(next-web): add selection cookie reader + setSelection action"
```

---

## Task 9: Auth Server Actions

**Files:**
- Create: `apps/next-web/src/server/actions/auth.ts`

- [ ] **Step 1: Implement**

```ts
// apps/next-web/src/server/actions/auth.ts
'use server';
import { redirect } from 'next/navigation';
import { setSessionCookies, clearSessionCookies } from '../cookies';

const API_BASE =
  process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const BFF_SECRET = process.env.BFF_SECRET ?? '';

function bffHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-BFF-Secret': BFF_SECRET };
}

export type LoginResult =
  | { ok: true; token: string; user: unknown }
  | { ok: false; mfaRequired: true; mfaToken: string }
  | { ok: false; error: string };

export async function login(email: string, password: string): Promise<LoginResult> {
  const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
    method: 'POST', headers: bffHeaders(), body: JSON.stringify({ email, password }), cache: 'no-store',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: json?.error?.message ?? 'Login failed' };
  const data = json.data;
  if (data?.mfaRequired) return { ok: false, mfaRequired: true, mfaToken: data.mfaToken };
  await setSessionCookies(data.token, data.refreshToken);
  return { ok: true, token: data.token, user: data.user };
}

export async function mfaChallenge(
  mfaToken: string, code?: string, recoveryCode?: string,
): Promise<LoginResult> {
  const res = await fetch(`${API_BASE}/api/v1/auth/mfa/challenge`, {
    method: 'POST', headers: bffHeaders(),
    body: JSON.stringify({ mfaToken, code, recoveryCode }), cache: 'no-store',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: json?.error?.message ?? 'Verification failed' };
  await setSessionCookies(json.data.token, json.data.refreshToken);
  return { ok: true, token: json.data.token, user: json.data.user };
}

export async function register(
  email: string, name: string, password: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/api/v1/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name, password }), cache: 'no-store',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: json?.error?.message ?? 'Registration failed' };
  return { ok: true };
}

export async function logout(): Promise<void> {
  await clearSessionCookies();
  redirect('/login');
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/next-web && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/next-web/src/server/actions/auth.ts
git commit -m "feat(next-web): add login/mfa/register/logout server actions"
```

---

## Task 10: `/api/auth/refresh` route handler (client rehydration)

**Files:**
- Create: `apps/next-web/src/app/api/auth/refresh/route.ts`

This is what the legacy `AuthBootstrap` calls. If the access cookie is still valid it returns it without rotating (so it doesn't fight the proxy); otherwise it refreshes from `pf_rt`.

- [ ] **Step 1: Implement**

```ts
// apps/next-web/src/app/api/auth/refresh/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE, COOKIE_BASE, ACCESS_MAX_AGE, REFRESH_MAX_AGE } from '@/server/cookies';
import { decodeJwt, isJwtExpired } from '@/server/jwt';

const API_BASE =
  process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const BFF_SECRET = process.env.BFF_SECRET ?? '';

export async function POST() {
  const jar = await cookies();
  const access = jar.get(COOKIE.access)?.value;
  const refresh = jar.get(COOKIE.refresh)?.value;

  // Still-valid access token: hand it back, no rotation.
  const claims = decodeJwt(access);
  if (claims && !isJwtExpired(claims)) {
    return NextResponse.json({ data: { token: access, user: { id: claims.userId, email: claims.email } } });
  }

  if (!refresh) {
    return NextResponse.json({ error: { message: 'No session' } }, { status: 401 });
  }

  const r = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'X-BFF-Secret': BFF_SECRET, Cookie: `refresh_token=${refresh}` },
  });
  if (!r.ok) {
    const res = NextResponse.json({ error: { message: 'Refresh failed' } }, { status: 401 });
    res.cookies.delete(COOKIE.access);
    res.cookies.delete(COOKIE.refresh);
    return res;
  }
  const j = await r.json();
  const newClaims = decodeJwt(j.data.token);
  const res = NextResponse.json({
    data: { token: j.data.token, user: { id: newClaims?.userId, email: newClaims?.email } },
  });
  res.cookies.set(COOKIE.access, j.data.token, { ...COOKIE_BASE, maxAge: ACCESS_MAX_AGE });
  res.cookies.set(COOKIE.refresh, j.data.refreshToken, { ...COOKIE_BASE, maxAge: REFRESH_MAX_AGE });
  return res;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/next-web && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/next-web/src/app/api/auth/refresh/route.ts
git commit -m "feat(next-web): add /api/auth/refresh route handler"
```

---

## Task 11: Proxy (refresh chokepoint + redirects)

**Files:**
- Create: `apps/next-web/src/proxy.ts`

- [ ] **Step 1: Implement**

```ts
// apps/next-web/src/proxy.ts
import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE, COOKIE_BASE, ACCESS_MAX_AGE, REFRESH_MAX_AGE } from '@/server/cookies';
import { decodeJwt, isJwtExpired } from '@/server/jwt';
import { decideAuth } from '@/server/auth-decision';

const API_BASE =
  process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const BFF_SECRET = process.env.BFF_SECRET ?? '';

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  let access = req.cookies.get(COOKIE.access)?.value;
  const refresh = req.cookies.get(COOKIE.refresh)?.value;

  let refreshed: { token: string; refreshToken: string } | null = null;
  let cleared = false;

  // Single per-request refresh chokepoint.
  if ((!access || isJwtExpired(decodeJwt(access))) && refresh) {
    try {
      const r = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'X-BFF-Secret': BFF_SECRET, Cookie: `refresh_token=${refresh}` },
      });
      if (r.ok) {
        const j = await r.json();
        access = j.data.token;
        refreshed = { token: j.data.token, refreshToken: j.data.refreshToken };
      } else {
        access = undefined;
        cleared = true;
      }
    } catch {
      // API unreachable — treat as unauthenticated for this request only.
      access = undefined;
    }
  }

  const applyCookies = (res: NextResponse) => {
    if (refreshed) {
      res.cookies.set(COOKIE.access, refreshed.token, { ...COOKIE_BASE, maxAge: ACCESS_MAX_AGE });
      res.cookies.set(COOKIE.refresh, refreshed.refreshToken, { ...COOKIE_BASE, maxAge: REFRESH_MAX_AGE });
    }
    if (cleared) {
      res.cookies.delete(COOKIE.access);
      res.cookies.delete(COOKIE.refresh);
    }
    return res;
  };

  const isAuthed = !!access && !isJwtExpired(decodeJwt(access));
  const decision = decideAuth(pathname, isAuthed);

  if (decision === 'redirect-login') {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return applyCookies(NextResponse.redirect(url));
  }
  if (decision === 'redirect-app') {
    const url = req.nextUrl.clone();
    url.pathname = '/board';
    return applyCookies(NextResponse.redirect(url));
  }
  return applyCookies(NextResponse.next());
}

export const config = {
  // Run on pages only: skip Next internals, API routes (/api/* incl. the /api/v1
  // rewrite and /api/auth handlers), static media, and any file with an extension.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|media|.*\\.).*)'],
};
```

- [ ] **Step 2: Typecheck + build**

Run: `cd apps/next-web && npx tsc --noEmit && npm run build`
Expected: build succeeds; Next reports a Proxy in the build output.

- [ ] **Step 3: Commit**

```bash
git add apps/next-web/src/proxy.ts
git commit -m "feat(next-web): add proxy refresh chokepoint + auth redirects"
```

---

## Task 12: Wire the login page to the `login` action

**Files:**
- Modify: `apps/next-web/src/app/login/page.tsx`

The page stays a Client Component. Replace the inline `fetch`-based `useMutation` with a call to the `login` Server Action; on success, populate the legacy in-memory store (so not-yet-migrated pages keep working) and navigate.

- [ ] **Step 1: Replace the login mutation**

Remove `import { useMutation } from '@tanstack/react-query';` (line 6) and add:

```tsx
import { useTransition } from 'react';
import { login as loginAction } from '@/server/actions/auth';
```

Replace the `loginMutation` block and the existing `handleSubmit` (currently lines 41-66) with:

```tsx
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    startTransition(async () => {
      const result = await loginAction(email, password);
      if (result.ok) {
        setAuth(result.token, result.user as any); // legacy in-memory hydration
        router.push('/board');
      } else if ('mfaRequired' in result) {
        router.push(`/oauth/mfa?token=${encodeURIComponent(result.mfaToken)}&returnTo=/board`);
      } else {
        setErrorMsg(result.error);
      }
    });
  }
```

- [ ] **Step 2: Update the submit button's pending flag**

Replace the three `loginMutation.isPending` references (currently lines 165, 167, 170) with `isPending`.

- [ ] **Step 3: Typecheck**

Run: `cd apps/next-web && npx tsc --noEmit`
Expected: no errors. (Full manual flow verified in Task 16.)

- [ ] **Step 4: Commit**

```bash
git add apps/next-web/src/app/login/page.tsx
git commit -m "feat(next-web): drive login via server action + cookie session"
```

---

## Task 13: Wire the register page to the `register` action

**Files:**
- Modify: `apps/next-web/src/app/register/page.tsx`

- [ ] **Step 1: Read the current file** to see its form/mutation shape.

Open `apps/next-web/src/app/register/page.tsx`.

- [ ] **Step 2: Replace its submit logic** with the action call (mirror Task 12). Swap the inline `fetch('/api/v1/auth/register', …)` / `useMutation` for:

```tsx
import { useTransition } from 'react';
import { register as registerAction } from '@/server/actions/auth';
```

```tsx
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    startTransition(async () => {
      const result = await registerAction(email, name, password);
      if (result.ok) router.push('/login?registered=1');
      else setErrorMsg(result.error ?? 'Registration failed');
    });
  }
```

Replace any `*.isPending` references on the submit button with `isPending`. Keep all existing field state/markup. (If the page uses different variable names than `email`/`name`/`password`/`setErrorMsg`/`router`, adapt the snippet to match.)

- [ ] **Step 3: Typecheck**

Run: `cd apps/next-web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/next-web/src/app/register/page.tsx
git commit -m "feat(next-web): drive register via server action"
```

---

## Task 14: Wire the OAuth MFA page to the `mfaChallenge` action

**Files:**
- Modify: `apps/next-web/src/app/oauth/mfa/page.tsx`

- [ ] **Step 1: Read the current file** to see how it reads `token`/`returnTo` and submits the code.

- [ ] **Step 2: Replace its submit logic** so it calls the action and hydrates the legacy store:

```tsx
import { useTransition } from 'react';
import { useStore } from '@/store/useStore';
import { mfaChallenge } from '@/server/actions/auth';
```

```tsx
  const setAuth = useStore((s) => s.setAuth);
  const [isPending, startTransition] = useTransition();

  function submitCode(code: string, recoveryCode?: string) {
    startTransition(async () => {
      const result = await mfaChallenge(mfaToken, code, recoveryCode);
      if (result.ok) {
        setAuth(result.token, result.user as any);
        router.push(returnTo || '/board');
      } else {
        setErrorMsg('error' in result ? result.error : 'Verification failed');
      }
    });
  }
```

Use the page's existing variable names for `mfaToken` (from the `token` query param), `returnTo`, `router`, and `setErrorMsg`; replace any old `fetch('/api/v1/auth/mfa/challenge', …)` call and its pending flag with `submitCode(...)` / `isPending`.

- [ ] **Step 3: Typecheck**

Run: `cd apps/next-web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/next-web/src/app/oauth/mfa/page.tsx
git commit -m "feat(next-web): drive MFA challenge via server action"
```

---

## Task 15: Rehydrate AuthBootstrap from the cookie session

**Files:**
- Modify: `apps/next-web/src/app/(app)/auth-bootstrap.tsx`

Point the existing client bootstrap at the new Next route handler instead of the backend, so legacy pages get their in-memory token from the cookie session. (Full removal of AuthBootstrap happens in Phase 3.)

- [ ] **Step 1: Change the fetch target**

Replace line 14 (`fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' })`) with:

```tsx
    fetch('/api/auth/refresh', { method: 'POST' })
```

The rest of the component is unchanged: on `res.ok` it still reads `json.data.token` / `json.data.user` and calls `setAuth(...)`; on failure the user logs in. (The proxy already redirects unauthenticated users away from `(app)` routes, so this is now belt-and-suspenders for the legacy in-memory token.)

- [ ] **Step 2: Typecheck**

Run: `cd apps/next-web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/next-web/src/app/(app)/auth-bootstrap.tsx"
git commit -m "feat(next-web): rehydrate AuthBootstrap from cookie session"
```

---

## Task 16: End-to-end verification

**Files:** none (verification only)

Prereq: API (`apps/api`) running with DB/Redis, `BFF_SECRET` set in both `.env` files, Next dev (`cd apps/next-web && npm run dev`).

- [ ] **Step 1: Fresh login sets cookies**
  - Visit `http://localhost:3000/board` while logged out → redirected to `/login` (proxy).
  - Log in. DevTools → Application → Cookies → `localhost:3000`: confirm `pf_at` and `pf_rt` exist, `HttpOnly`, `Path=/`. You land on `/board` with data.

- [ ] **Step 2: Reload persists the session (no double login)**
  - Hard-reload `/board`. You stay authenticated; no redirect to `/login`. (`AuthBootstrap` → `/api/auth/refresh` returns the current token; legacy pages still render.)

- [ ] **Step 3: Access-token refresh works**
  - In DevTools, delete only the `pf_at` cookie (leave `pf_rt`). Navigate to another route (e.g. `/projects`). Proxy re-mints `pf_at`; you stay logged in.

- [ ] **Step 4: Authed users bounce off /login**
  - Visit `/login` while authenticated → redirected to `/board`.

- [ ] **Step 5: Logout clears cookies**
  - While logged in, run in the browser console: `fetch('/api/auth/refresh',{method:'POST'}).then(r=>r.json()).then(console.log)` → returns a token.
  - Delete `pf_at` and `pf_rt` manually (simulating `clearSessionCookies`) and confirm `/board` redirects to `/login`. (The `logout` action is wired into the UI during page migration.)

- [ ] **Step 6: MFA path** (only if you have an MFA-enabled test user)
  - Log in with that user → redirected to `/oauth/mfa` → submit TOTP → cookies set → land on `/board`.

- [ ] **Step 7: Suite + build green**

Run: `cd apps/next-web && npm run build && npx vitest run`
Run: `cd apps/api && npx vitest run src/modules/auth`
Expected: build succeeds; both test runs PASS.

- [ ] **Step 8: Final Phase 0 commit**

```bash
git add -A
git commit -m "chore(ssr): Phase 0 BFF foundation complete" --allow-empty
```

---

## Self-Review

- **Spec coverage (spec §3–§5):** Cookies §3.1 → Task 5; proxy refresh §3.2 → Tasks 4+11; DAL §3.3 → Tasks 3,6,7,8; auth actions §3.4 → Task 9; selection cookie §3.1/§3.3 → Task 8; backend `X-BFF-Secret` §5.1 → Task 1; auth flows §4.1–4.3 → Tasks 9,10,11,12,13,14,15. **OAuth §4.4 / rotation grace §5.3 are explicitly deferred to Phase 0.B** (documented in Scope) — not silently dropped. Page→RSC migration (spec §6/§7 Phases 1–3) is out of this plan by design.
- **Placeholders:** none — every code step has complete content; the two page-wiring tasks (13,14) instruct reading the file first because their exact current contents weren't captured, and supply the complete replacement snippet.
- **Type consistency:** `COOKIE`, `COOKIE_BASE`, `ACCESS_MAX_AGE`, `REFRESH_MAX_AGE`, `SELECTION_MAX_AGE` defined in Task 5 and reused verbatim in Tasks 8,10,11. `JwtClaims`/`decodeJwt`/`isJwtExpired` (Task 3) reused in Tasks 6,10,11. `LoginResult` (Task 9) consumed in Task 12. `serverFetch` returns unwrapped `data` consistently. ✓

---

## Execution Handoff

Phase 0 plan saved to `docs/superpowers/plans/2026-05-20-csr-to-ssr-migration-phase0.md`.
