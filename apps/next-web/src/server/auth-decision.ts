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
