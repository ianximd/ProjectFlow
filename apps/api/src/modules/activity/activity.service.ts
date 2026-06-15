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
import type { ActivityFilters, AuditLogEntry, AuditLogPage } from '@projectflow/types';
import type { HierarchyNodeType } from '@projectflow/types';

/**
 * Map from AuditLog resource strings → hierarchy node types for object-level
 * post-filter. Resources not in this map are workspace-wide and pass through.
 */
const HIERARCHY_RESOURCE: Record<string, HierarchyNodeType> = {
  Project:  'SPACE',
  Folder:   'FOLDER',
  List:     'LIST',
  // 'Task' is intentionally omitted — task visibility is derived from the
  // containing LIST; the list-level check is sufficient for v1.
};

const _cfRepo = new CustomFieldRepository();

export class ActivityService {
  /**
   * Resolve the scope node, build audit filters, read the page from the SP,
   * then post-filter entries the caller cannot see at the object level.
   *
   * @param userId    - caller's userId (from GQLContext.user.userId)
   * @param scopeType - view scope type: LIST | FOLDER | SPACE | EVERYTHING
   * @param scopeId   - scope object id (null for EVERYTHING)
   * @param filters   - optional ActivityFilters from the GraphQL args
   */
  async getActivity(
    userId:    string,
    scopeType: string,
    scopeId:   string | null,
    filters:   ActivityFilters = {},
  ): Promise<AuditLogPage> {
    // 1. Resolve workspace from scope
    let workspaceId: string;
    let scopePath:   string;

    if (scopeType === 'EVERYTHING') {
      // For EVERYTHING scope the caller must supply a workspaceId via filters
      // (the GraphQL resolver enforces this via requireEverythingWorkspace).
      // The scope node is the workspace itself; we derive the path from the id.
      if (!scopeId) {
        throw new GraphQLError('workspaceId (scopeId) is required for EVERYTHING scope', {
          extensions: { code: 'BAD_REQUEST' },
        });
      }
      workspaceId = scopeId;
      scopePath   = `/${scopeId}/`;
    } else {
      const node = await _cfRepo.getScopeNode(
        scopeType as 'LIST' | 'FOLDER' | 'SPACE',
        scopeId!,
      );
      if (!node) {
        throw new GraphQLError('Scope not found', { extensions: { code: 'NOT_FOUND' } });
      }
      workspaceId = node.workspaceId;
      scopePath   = node.scopePath;
    }

    // 2. Build the SP filter bag
    const auditFilters = buildAuditFilters(
      { workspaceId, scopePath },
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
}

export const activityService = new ActivityService();
