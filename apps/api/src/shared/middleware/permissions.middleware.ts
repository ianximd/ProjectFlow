import type { Context, Next } from 'hono';
import { roleService } from '../../modules/roles/role.service.js';
import { WorkspaceRepository } from '../../modules/workspaces/workspace.repository.js';
import { subLogger } from '../lib/logger.js';

const log = subLogger('freeze-guard');
const workspaceRepo = new WorkspaceRepository();

// HTTP methods that mutate state — the only ones the freeze guard fires on.
// GET/HEAD/OPTIONS can stay readable on a frozen workspace.
const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

// Holding ANY admin.workspaces.* slug bypasses the freeze guard. Narrower
// than this (e.g. only admin.workspaces.update) locks admins out of legit
// remediation: they couldn't archive a frozen workspace with just
// admin.workspaces.delete, even though that's exactly what the slug grants.
function hasAdminWorkspaceBypass(perms: Set<string>): boolean {
  for (const p of perms) if (p.startsWith('admin.workspaces.')) return true;
  return false;
}

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
  /**
   * Async resolver for routes where the workspace must be derived from a
   * resource (e.g. /tasks/:id → look up Task.WorkspaceId). Wins over
   * workspaceParam/workspaceId when provided. Return null to fail-closed.
   *
   * Note: the resolver is awaited inside the middleware, so it should be a
   * single SP call. Result is reused across all permission gates on the same
   * request via the per-context cache below.
   */
  resolveWorkspace?: (c: Context) => Promise<string | null>;
  /**
   * Tighten the primary check: even if the user holds the required slug, deny
   * unless they are also the resource owner. Use for `*.own`-only permissions
   * (e.g. PATCH /comments/:id requires `comment.update.own` AND ownership).
   * Resolver should return the owner userId, or null when the resource is
   * missing (treated as 404).
   */
  ownerOnly?: (c: Context) => Promise<string | null>;
  /**
   * Widen the primary check: if the user lacks the required slug, allow when
   * they hold `slug` AND are the resource owner. Use to express
   * "DELETE my own comment" alongside "DELETE any comment".
   */
  ownerFallback?: {
    slug: string;
    resolveOwner: (c: Context) => Promise<string | null>;
  };
}

/**
 * Hono middleware that gates a route on a permission slug. Pass a string[] to
 * require ANY-OF — useful when a system-scoped admin permission should also
 * satisfy a workspace-scoped check (e.g. super-admin can delete any workspace).
 *
 *   adminRoutes.get('/users', requirePermission('admin.users.read'), handler);
 *   workspaceRoutes.delete(
 *     '/:id',
 *     requirePermission(['workspace.delete', 'admin.workspaces.delete'], { workspaceParam: 'id' }),
 *     handler,
 *   );
 */
export function requirePermission(
  slug: string | string[],
  opts: RequirePermissionOptions = {},
) {
  const slugs = Array.isArray(slug) ? slug : [slug];

  return async (c: Context, next: Next) => {
    const userId = getUserId(c);
    if (!userId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 } }, 401);
    }

    let workspaceId: string | null | undefined;
    if (opts.resolveWorkspace) {
      // Cache the resolved id on the context so multi-gate routes don't re-query.
      const cached = (c as any).get('resolvedWorkspaceId') as string | null | undefined;
      workspaceId = cached !== undefined ? cached : await opts.resolveWorkspace(c);
      (c as any).set('resolvedWorkspaceId', workspaceId);
      if (!workspaceId) {
        return c.json(
          { error: { code: 'NOT_FOUND', message: 'Resource not found', statusCode: 404 } },
          404,
        );
      }
    } else {
      workspaceId =
        opts.workspaceId ??
        (opts.workspaceParam ? c.req.param(opts.workspaceParam) ?? c.req.query(opts.workspaceParam) : null);
    }

    const permissions = await loadPermissions(c, workspaceId ?? null);

    let allowed = slugs.some((s) => permissions.has(s));

    // ownerOnly: tighten — must also be the resource owner.
    if (allowed && opts.ownerOnly) {
      const ownerId = await opts.ownerOnly(c);
      if (ownerId === null) {
        return c.json(
          { error: { code: 'NOT_FOUND', message: 'Resource not found', statusCode: 404 } },
          404,
        );
      }
      if (ownerId !== userId) allowed = false;
    }

    // ownerFallback: widen — owner with the fallback slug counts.
    if (!allowed && opts.ownerFallback && permissions.has(opts.ownerFallback.slug)) {
      const ownerId = await opts.ownerFallback.resolveOwner(c);
      if (ownerId === null) {
        return c.json(
          { error: { code: 'NOT_FOUND', message: 'Resource not found', statusCode: 404 } },
          404,
        );
      }
      if (ownerId === userId) allowed = true;
    }

    if (allowed) {
      // Freeze guard: even with the right permission, refuse writes when the
      // workspace is FROZEN or SUSPENDED. Admins holding admin.workspaces.update
      // bypass (otherwise they couldn't unfreeze it).
      if (workspaceId && WRITE_METHODS.has(c.req.method) && !hasAdminWorkspaceBypass(permissions)) {
        const frozenResp = await checkFreezeGuard(c, workspaceId);
        if (frozenResp) return frozenResp;
      }
      await next();
      return;
    }

    return c.json(
      {
        error: {
          code:       'FORBIDDEN',
          message:    slugs.length > 1
            ? `Permission required (any of: ${slugs.join(', ')})`
            : `Permission '${slugs[0]}' required`,
          statusCode: 403,
        },
      },
      403,
    );
  };
}

// ─── Freeze guard ────────────────────────────────────────────────────────────

interface WorkspaceStatusSnapshot {
  status:    string;
  deletedAt: Date | null;
}

// Load + cache the workspace status on the request context. Most writes only
// touch one workspace per request, but routes that gate twice (e.g.
// ownerFallback combined with the primary check) would otherwise hit the DB
// twice. One SP call per request, max.
async function loadWorkspaceStatusSnapshot(
  c: Context,
  workspaceId: string,
): Promise<WorkspaceStatusSnapshot | null> {
  const key = `workspaceStatus:${workspaceId}`;
  const cached = (c as any).get(key) as WorkspaceStatusSnapshot | null | undefined;
  if (cached !== undefined) return cached;

  const row = await workspaceRepo.getStatus(workspaceId);
  const snap: WorkspaceStatusSnapshot | null = row
    ? { status: row.Status, deletedAt: row.DeletedAt }
    : null;
  (c as any).set(key, snap);
  return snap;
}

async function checkFreezeGuard(c: Context, workspaceId: string) {
  const snap = await loadWorkspaceStatusSnapshot(c, workspaceId);
  // Missing workspace — let the route's own resource lookup handle the 404.
  if (!snap) return null;
  // Soft-deleted workspaces are blocked elsewhere (resource lookups filter
  // DeletedAt); freeze guard only cares about Status.
  if (snap.deletedAt) return null;

  if (snap.status === 'FROZEN' || snap.status === 'SUSPENDED') {
    const code = snap.status === 'FROZEN' ? 'WORKSPACE_FROZEN' : 'WORKSPACE_SUSPENDED';
    log.warn(
      { workspaceId, status: snap.status, method: c.req.method, path: c.req.path },
      'write blocked by freeze guard',
    );
    return c.json(
      {
        error: {
          code,
          message: snap.status === 'FROZEN'
            ? 'Workspace is frozen — writes are temporarily disabled.'
            : 'Workspace is suspended — writes are not permitted.',
          statusCode: 403,
        },
      },
      403,
    );
  }
  return null;
}
