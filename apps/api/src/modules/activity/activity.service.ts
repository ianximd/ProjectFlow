/**
 * Phase 9e — Activity service.
 *
 * Orchestrates scope resolution, filter building, SP read, and object-level
 * post-filtering. The `total` field reflects the unfiltered SP count (v1
 * trade-off: we post-filter for object-level visibility but do not re-count).
 */

import { GraphQLError } from 'graphql';
import { CustomFieldRepository } from '../customfields/customfield.repository.js';
import { accessService } from '../access/access.service.js';
import { activityRepository } from './activity.repository.js';
import { buildAuditFilters } from './activity-scope.js';
import { TaskRepository } from '../tasks/task.repository.js';
import type { ActivityFilters, AuditLogEntry, AuditLogPage } from '@projectflow/types';
import type { HierarchyNodeType } from '@projectflow/types';

/**
 * Map from AuditLog resource strings → hierarchy node types for object-level
 * post-filter. Resources not in this map are workspace-wide and pass through.
 *
 * NOTE — current audit reality: the audit middleware only writes `Project`
 * (→SPACE) among hierarchy resources. `Folder` and `List` rows are not
 * currently produced by any audited route, so those map entries are
 * inert-but-forward-compatible: they are retained so that object-level
 * filtering applies automatically once Folder/List audit middleware lands.
 */
const HIERARCHY_RESOURCE: Record<string, HierarchyNodeType> = {
  Project:  'SPACE',
  Folder:   'FOLDER',
  List:     'LIST',
  // 'Task' is intentionally omitted — task visibility is derived from the
  // containing LIST; the list-level check is sufficient for v1.
};

const _cfRepo    = new CustomFieldRepository();
const _taskRepo  = new TaskRepository();

export class ActivityService {
  /**
   * Resolve the scope node, build audit filters, read the page from the SP,
   * then post-filter entries the caller cannot see at the object level.
   *
   * @param userId      - caller's userId (from GQLContext.user.userId)
   * @param scopeType   - view scope type: LIST | FOLDER | SPACE | EVERYTHING
   * @param scopeId     - scope object id (null for EVERYTHING)
   * @param workspaceId - workspace id; required for EVERYTHING scope,
   *                      looked up from the node for LIST/FOLDER/SPACE
   * @param filters     - optional ActivityFilters from the GraphQL args
   */
  async getActivity(
    userId:      string,
    scopeType:   string,
    scopeId:     string | null,
    workspaceId: string | undefined,
    filters:     ActivityFilters = {},
  ): Promise<AuditLogPage> {
    // 1. Resolve workspace from scope
    let resolvedWorkspaceId: string;

    if (scopeType === 'EVERYTHING') {
      // For EVERYTHING scope the caller must supply a workspaceId.
      // The GraphQL resolver enforces this via requireEverythingWorkspace.
      if (!workspaceId) {
        throw new GraphQLError('workspaceId is required for EVERYTHING scope', {
          extensions: { code: 'BAD_REQUEST' },
        });
      }
      resolvedWorkspaceId = workspaceId;
    } else {
      const node = await _cfRepo.getScopeNode(
        scopeType as 'LIST' | 'FOLDER' | 'SPACE',
        scopeId!,
      );
      if (!node) {
        throw new GraphQLError('Scope not found', { extensions: { code: 'NOT_FOUND' } });
      }
      resolvedWorkspaceId = node.workspaceId;
    }

    // 2. Build the SP filter bag
    const auditFilters = buildAuditFilters(
      { workspaceId: resolvedWorkspaceId, scopePath: '' },
      { scopeType, scopeId },
      filters,
    );

    // 3. Read page from DB
    const page = await activityRepository.listScoped(auditFilters);

    // 4. Post-filter for object-level visibility
    const visible = await Promise.all(
      page.entries.map(async (entry: AuditLogEntry) => {
        const nodeType = entry.resource ? HIERARCHY_RESOURCE[entry.resource] : undefined;
        if (!nodeType || !entry.resourceId) {
          // Not a hierarchy resource — pass through
          return entry;
        }
        const allowed = await accessService.can(userId, nodeType, entry.resourceId, 'VIEW');
        return allowed ? entry : null;
      }),
    );

    return {
      entries:  visible.filter((e): e is AuditLogEntry => e !== null),
      total:    page.total,   // v1: unfiltered SP count (documented trade-off)
      page:     page.page,
      pageSize: page.pageSize,
    };
  }

  /**
   * Activity feed for a single task. Visibility derives from the containing
   * LIST (same rule as HIERARCHY_RESOURCE). Reuses listScoped with a
   * resourceId=taskId filter — task UPDATE audit rows carry resourceId=taskId.
   */
  async getTaskActivity(
    userId:   string,
    taskId:   string,
    opts:     { page?: number; pageSize?: number } = {},
  ): Promise<AuditLogPage> {
    const task = await _taskRepo.getById(taskId);
    if (!task) {
      throw new GraphQLError('Task not found', { extensions: { code: 'NOT_FOUND' } });
    }
    const listId = (task as { ListId?: string; listId?: string }).ListId
                 ?? (task as { listId?: string }).listId;
    const workspaceId = (task as { WorkspaceId?: string; workspaceId?: string }).WorkspaceId
                 ?? (task as { workspaceId?: string }).workspaceId;
    if (!listId || !workspaceId) {
      throw new GraphQLError('Task not found', { extensions: { code: 'NOT_FOUND' } });
    }
    const allowed = await accessService.can(userId, 'LIST', listId, 'VIEW');
    if (!allowed) {
      throw new GraphQLError('Forbidden', { extensions: { code: 'FORBIDDEN' } });
    }
    return activityRepository.listScoped({
      workspaceId,
      resourceId: taskId,
      page:       opts.page && opts.page >= 1 ? opts.page : 1,
      pageSize:   opts.pageSize && opts.pageSize >= 1 ? Math.min(opts.pageSize, 200) : 50,
    });
  }
}

export const activityService = new ActivityService();
