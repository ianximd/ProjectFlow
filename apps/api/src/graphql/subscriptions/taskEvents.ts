import { GraphQLError } from 'graphql';
import { pubsub } from '../pubsub.js';
import { requireObjectLevel, requireWorkspacePermission } from '../authz.js';
import { taskEventKey } from '../task-events.js';

/**
 * Extracted, authz-gated subscribe for the `taskEvents` field.
 *
 *   - A `projectId` scope = a Space; VIEW-gated via the hierarchy ACL (mirrors
 *     every other Space-scoped read) and bound to the `prj:<id>` topic key.
 *   - A `workspaceId` scope is RBAC-gated on `workspace.read` and bound to the
 *     `ws:<id>` topic key (cross-project workspace feed).
 *
 * Exactly one scope must be supplied.
 */
export async function taskEventsSubscribe(
  args: { projectId?: string | null; workspaceId?: string | null },
  ctx: any,
) {
  if (args.projectId) {
    await requireObjectLevel(ctx, 'SPACE', args.projectId, 'VIEW');
    return pubsub.subscribe('task:event', taskEventKey.project(args.projectId));
  }
  if (args.workspaceId) {
    await requireWorkspacePermission(ctx, args.workspaceId, 'workspace.read');
    return pubsub.subscribe('task:event', taskEventKey.workspace(args.workspaceId));
  }
  throw new GraphQLError('taskEvents requires projectId or workspaceId', { extensions: { code: 'BAD_REQUEST' } });
}
