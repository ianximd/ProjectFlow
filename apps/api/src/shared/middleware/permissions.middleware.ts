import type { Context, Next } from 'hono';
import { roleService } from '../../modules/roles/role.service.js';

// ─── Legacy env-var fallback (super-admin) ───────────────────────────────────
//
// Once the Phase-2 startup hook auto-promotes ADMIN_USER_IDS, this fallback
// becomes a safety net. It allows users still listed in the env var to keep
// system access if their DB assignment is somehow missing, and warns so we
// can spot the drift. Slated for removal after the next release.

const LEGACY_ADMIN_IDS: Set<string> = new Set(
  (process.env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

// ─── Cache key ───────────────────────────────────────────────────────────────

function cacheKey(workspaceId?: string | null): string {
  return `permissions:${workspaceId ?? 'system'}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getUserId(c: Context): string | null {
  // server.ts already attaches `user` after authMiddleware.
  const user = (c as any).get('user');
  return user?.userId ?? user?.id ?? null;
}

/**
 * Resolve the user's effective permission set for the given workspace
 * (or system permissions only when workspaceId is null/undefined).
 *
 * Cached on the Hono context so multiple gates in one request don't re-query.
 */
export async function loadPermissions(
  c: Context,
  workspaceId?: string | null,
): Promise<Set<string>> {
  const key   = cacheKey(workspaceId);
  const cached = (c as any).get(key) as Set<string> | undefined;
  if (cached) return cached;

  const userId = getUserId(c);
  if (!userId) return new Set();

  const slugs = await roleService.getUserPermissionSlugs(userId, workspaceId ?? null);
  (c as any).set(key, slugs);
  return slugs;
}

// ─── Middleware factory ──────────────────────────────────────────────────────

export interface RequirePermissionOptions {
  /** Path/query param name that holds the workspace id; omit for system permissions. */
  workspaceParam?: string;
  /** Explicit workspace id (overrides workspaceParam). */
  workspaceId?: string;
}

/**
 * Hono middleware that gates a route on a permission slug.
 *
 *   adminRoutes.get('/users', requirePermission('admin.users.read'), handler);
 *   workspaceRoutes.delete('/:id', requirePermission('workspace.delete', { workspaceParam: 'id' }), handler);
 */
export function requirePermission(
  slug: string,
  opts: RequirePermissionOptions = {},
) {
  return async (c: Context, next: Next) => {
    const userId = getUserId(c);
    if (!userId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 } }, 401);
    }

    const workspaceId =
      opts.workspaceId ??
      (opts.workspaceParam ? c.req.param(opts.workspaceParam) ?? c.req.query(opts.workspaceParam) : null);

    const permissions = await loadPermissions(c, workspaceId ?? null);

    if (permissions.has(slug)) {
      await next();
      return;
    }

    // Legacy env-var fallback for system-scope checks only.
    if (!workspaceId && LEGACY_ADMIN_IDS.has(userId)) {
      console.warn(
        `[permissions] Falling back to legacy ADMIN_USER_IDS for user ${userId}; ` +
        `assign super-admin role in DB to remove this warning.`,
      );
      await next();
      return;
    }

    return c.json(
      {
        error: {
          code:       'FORBIDDEN',
          message:    `Permission '${slug}' required`,
          statusCode: 403,
        },
      },
      403,
    );
  };
}
