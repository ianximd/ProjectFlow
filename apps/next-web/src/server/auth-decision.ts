export type AuthDecision = 'allow' | 'redirect-login' | 'redirect-app';

// Routes reachable without a session. Everything else is protected.
const PUBLIC_EXACT = new Set(['/']);
const PUBLIC_PREFIXES = ['/login', '/register', '/oauth'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Decide what the proxy should do for a request:
 * - 'allow'          → pass the request through
 * - 'redirect-login' → 302 to /login (unauthenticated user on a protected route)
 * - 'redirect-app'   → 302 to the app (authenticated user on a sign-in/landing route)
 *
 * Intentional asymmetry: `/oauth/*` is public so an unauthenticated user can be
 * mid-OAuth, but authenticated users are NOT bounced off it — the OAuth
 * finish/MFA pages complete the sign-in transition and must stay reachable.
 * Only the pure entry routes (`/login`, `/register`, `/`) bounce an authed user.
 */
export function decideAuth(pathname: string, isAuthed: boolean): AuthDecision {
  if (!isAuthed) return isPublic(pathname) ? 'allow' : 'redirect-login';
  if (pathname === '/login' || pathname === '/register' || pathname === '/') return 'redirect-app';
  return 'allow';
}
