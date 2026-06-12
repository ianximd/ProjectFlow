import { Hono } from 'hono';
import { viewService } from './view.service.js';
import { accessService } from '../access/access.service.js';
import { roleService } from '../roles/role.service.js';
import type { ViewConfig, ViewScopeType, CapacityRow } from '@projectflow/types';

export const capacityRoutes = new Hono();

const SCOPES: readonly ViewScopeType[] = ['LIST', 'FOLDER', 'SPACE', 'EVERYTHING'];

/**
 * Sanitize a CapacityRow's ratio field: JSON.stringify turns Infinity → null,
 * which diverges from the GraphQL surface (clamped to 1e9). Map it here so both
 * surfaces agree on the representation for zero-capacity rows.
 */
function sanitizeRow(r: CapacityRow): CapacityRow {
  return { ...r, ratio: Number.isFinite(r.ratio) ? r.ratio : 1e9 };
}

// GET /views/capacity?scopeType=&scopeId=&config=<json>&from=&to=&workspaceId=
//
// REST mirror of the GraphQL `viewCapacity` query. Fail-closed authz is
// enforced BEFORE any aggregation:
//   - Node scopes (LIST/FOLDER/SPACE): require object-level VIEW access.
//   - EVERYTHING scope: require workspace.read permission slug (mirrors
//     requireEverythingWorkspace in views.schema.ts).
//
// Returns 400 on bad scope/config, 401 on missing auth, 403 on no access,
// 404 when the scope node does not exist.
capacityRoutes.get('/capacity', async (c) => {
  const user = (c as any).get('user') as { userId: string } | undefined;
  if (!user) return c.json({ error: { message: 'Unauthorized' } }, 401);

  const scopeType = c.req.query('scopeType') as ViewScopeType | undefined;
  if (!scopeType || !SCOPES.includes(scopeType)) {
    return c.json({ error: { message: `Invalid scopeType (expected one of: ${SCOPES.join(', ')})` } }, 400);
  }

  const scopeId    = c.req.query('scopeId') ?? null;
  const workspaceId = c.req.query('workspaceId') ?? undefined;

  let config: ViewConfig;
  try { config = JSON.parse(c.req.query('config') ?? '') as ViewConfig; }
  catch { return c.json({ error: { message: 'Invalid config JSON' } }, 400); }

  // ── Fail-closed authorization (mirrors views.schema.ts requireEverythingWorkspace
  //    / requireObjectLevel gate — both surfaces enforce the same rules) ──────────
  if (scopeType === 'EVERYTHING') {
    if (!workspaceId) {
      return c.json({ error: { message: 'workspaceId is required for EVERYTHING-scoped capacity' } }, 400);
    }
    // getUserPermissionSlugs returns Promise<Set<string>> — use .has()
    const perms = await roleService.getUserPermissionSlugs(user.userId, workspaceId);
    if (!perms.has('workspace.read')) {
      return c.json({ error: { message: 'Forbidden' } }, 403);
    }
  } else {
    if (!scopeId) {
      return c.json({ error: { message: 'scopeId is required for non-EVERYTHING scopes' } }, 400);
    }
    const { level, found } = await accessService.resolveOrNull(user.userId, scopeType as any, scopeId);
    if (!found) return c.json({ error: { message: 'Not found' } }, 404);
    if (!level)  return c.json({ error: { message: 'Forbidden' } }, 403);
    // 'level' being non-null means the user holds VIEW or higher — VIEW is the
    // minimum required (mirrors requireObjectLevel(..., 'VIEW') in GraphQL).
    // accessService.resolveOrNull returns null when no ACL entry exists (not found
    // or no access), and a non-null ObjectPermissionLevel when they have at least
    // the lowest level. VIEW is the floor level so any resolved level is sufficient.
  }

  const result = await viewService.capacity(
    scopeType, scopeId, config,
    { from: c.req.query('from') ?? null, to: c.req.query('to') ?? null },
    workspaceId, user.userId,
  );

  // Sanitize ratio values (Infinity → 1e9) for JSON-safety, matching the
  // GraphQL surface's clamp on the same field.
  const sanitized = { ...result, rows: result.rows.map(sanitizeRow) };
  return c.json({ data: sanitized });
});
