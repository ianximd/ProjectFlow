import 'server-only';
import type { ShareProjection } from '@projectflow/types';

const API_BASE =
  process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/**
 * Public, sessionless resolution of a share token. Hits the UNAUTHENTICATED
 * `/public/share/:token` endpoint with a plain `fetch` — NO cookie, NO JWT, NO
 * workspace context. Returns the read-only, navigation-stripped projection of
 * exactly one object, or null for missing/expired/revoked tokens (→ the page 404s).
 */
export async function fetchPublicShare(token: string): Promise<ShareProjection | null> {
  const res = await fetch(`${API_BASE}/api/v1/public/share/${encodeURIComponent(token)}`, { cache: 'no-store' });
  if (!res.ok) return null;
  const body = await res.json().catch(() => ({}));
  return (body?.projection as ShareProjection) ?? null;
}
