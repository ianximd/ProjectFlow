/**
 * Phase 9e — Activity scope → audit-filter mapping.
 *
 * Pure (no I/O) helpers that translate a view's scope (scopeType/scopeId)
 * and user-supplied ActivityFilters into the AuditListFilters bag the
 * ActivityRepository passes to usp_AuditLog_List.
 */

import type { ActivityFilters } from '@projectflow/types';

/** The shape returned by CustomFieldRepository.getScopeNode (camelCase). */
export interface ScopeNode {
  workspaceId: string;
  scopePath:   string;
}

/** Scope descriptor from the GraphQL activityFeed args. */
export interface ScopeDescriptor {
  scopeType: string;
  scopeId:   string | null;
}

/** The AuditListFilters shape consumed by ActivityRepository. */
export interface AuditFilters {
  workspaceId: string;
  userId?:     string;
  resource?:   string;
  action?:     string;
  resourceId?: string;
  fromDate?:   Date;
  toDate?:     Date;
  page:        number;
  pageSize:    number;
}

/** Default page size for activity feed queries. */
const DEFAULT_PAGE_SIZE = 25;
/** Maximum allowed page size. */
const MAX_PAGE_SIZE = 100;

/**
 * Clamp a page number to a minimum of 1.
 * Undefined/null/zero/negative all become 1.
 */
export function clampPage(page: number | undefined): number {
  return (page && page >= 1) ? page : 1;
}

/**
 * Clamp a pageSize value into [1, MAX_PAGE_SIZE].
 * Falls back to DEFAULT_PAGE_SIZE if undefined.
 */
export function nz(pageSize: number | undefined): number {
  if (!pageSize || pageSize < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(pageSize, MAX_PAGE_SIZE);
}

/**
 * Build an AuditFilters bag from:
 *  - `node`    — the resolved scope node (workspaceId + scopePath from getScopeNode)
 *  - `scope`   — the view's scopeType + scopeId
 *  - `filters` — the caller-supplied ActivityFilters (all optional)
 *
 * For LIST/FOLDER/SPACE scopes the scopeId is forwarded as resourceId so the
 * SP can narrow rows to events that touched objects inside that scope.
 * For EVERYTHING scopes no resourceId filter is applied.
 */
export function buildAuditFilters(
  node:    ScopeNode,
  scope:   ScopeDescriptor,
  filters: ActivityFilters,
): AuditFilters {
  const resourceId =
    scope.scopeType !== 'EVERYTHING' && scope.scopeId
      ? scope.scopeId
      : undefined;

  return {
    workspaceId: node.workspaceId,
    userId:      filters.actor    ?? undefined,
    resource:    filters.resource ?? undefined,
    action:      filters.action   ?? undefined,
    resourceId,
    page:        clampPage(filters.page),
    pageSize:    nz(filters.pageSize),
  };
}
