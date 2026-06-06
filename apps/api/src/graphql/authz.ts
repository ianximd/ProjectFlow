/**
 * GraphQL authorization helpers — the GraphQL mirror MUST enforce the same
 * access control as the REST routes. Before these helpers existed, every
 * resolver gated only on `requireAuth` (token presence), which let any
 * authenticated user read/write every other workspace's data via /graphql.
 *
 * Two systems, mirroring the REST middleware exactly:
 *   - requireWorkspacePermission → RBAC slug check  (mirrors requirePermission)
 *   - requireObjectLevel         → hierarchy ACL     (mirrors requireObjectAccess)
 *
 * Both throw GraphQLError with the same FORBIDDEN / NOT_FOUND codes the REST
 * layer returns (404 for an unresolvable resource, fail-closed).
 */
import { GraphQLError } from 'graphql';
import type { GQLContext } from './context.js';
import type { HierarchyNodeType, ObjectPermissionLevel } from '@projectflow/types';
import { roleService } from '../modules/roles/role.service.js';
import { accessService, LEVEL_ORDER } from '../modules/access/access.service.js';

export function requireAuth(
  ctx: { user: unknown },
): asserts ctx is { user: { userId: string } } {
  if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
}

function forbidden(message = 'You do not have access'): never {
  throw new GraphQLError(message, { extensions: { code: 'FORBIDDEN' } });
}

export function notFound(message = 'Resource not found'): never {
  throw new GraphQLError(message, { extensions: { code: 'NOT_FOUND' } });
}

/**
 * Gate on a workspace RBAC permission slug (any-of). Mirrors
 * requirePermission(slug, { resolveWorkspace }). A null/undefined workspaceId
 * (unresolvable resource) is treated as 404, fail-closed.
 */
export async function requireWorkspacePermission(
  ctx: GQLContext,
  workspaceId: string | null | undefined,
  slugs: string | string[],
): Promise<string> {
  requireAuth(ctx);
  if (!workspaceId) notFound();
  const want = Array.isArray(slugs) ? slugs : [slugs];
  const perms = await roleService.getUserPermissionSlugs(ctx.user.userId, workspaceId);
  if (!want.some((s) => perms.has(s))) {
    forbidden(want.length > 1 ? `Permission required (any of: ${want.join(', ')})` : `Permission '${want[0]}' required`);
  }
  return workspaceId;
}

/**
 * Gate on the caller's effective level for a hierarchy object (SPACE/FOLDER/
 * LIST). Mirrors requireObjectAccess(min, resolveObject). A null/undefined id
 * is treated as 404, fail-closed.
 */
export async function requireObjectLevel(
  ctx: GQLContext,
  type: HierarchyNodeType,
  id: string | null | undefined,
  min: ObjectPermissionLevel,
): Promise<void> {
  requireAuth(ctx);
  if (!id) notFound();
  const { level, found } = await accessService.resolveOrNull(ctx.user.userId, type, id);
  if (!found) notFound();
  if (!level || LEVEL_ORDER[level] < LEVEL_ORDER[min]) forbidden();
}
