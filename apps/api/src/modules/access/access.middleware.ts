import type { Context, Next } from 'hono';
import type { HierarchyNodeType, ObjectPermissionLevel } from '@projectflow/types';
import { accessService, LEVEL_ORDER } from './access.service.js';

function getUserId(c: Context): string | null {
  const u = (c as any).get('user');
  return u?.userId ?? null;
}

/** Gate a route on the caller's effective level for a hierarchy object. */
export function requireObjectAccess(
  min: ObjectPermissionLevel,
  resolveObject: (c: Context) => { type: HierarchyNodeType; id: string } | null,
) {
  return async (c: Context, next: Next) => {
    const userId = getUserId(c);
    if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
    const obj = resolveObject(c);
    if (!obj?.id) return c.json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } }, 404);

    const { level, found } = await accessService.resolveOrNull(userId, obj.type, obj.id);
    if (!found) return c.json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } }, 404);
    if (!level || LEVEL_ORDER[level] < LEVEL_ORDER[min]) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'You do not have access' } }, 403);
    }
    await next();
  };
}
