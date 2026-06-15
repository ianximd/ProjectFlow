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

/** Default page size for activity feed queries (matches usp_AuditLog_List default). */
const DEFAULT_PAGE_SIZE = 50;
/** Maximum allowed page size (matches usp_AuditLog_List cap). */
const MAX_PAGE_SIZE = 200;

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
export function clampPageSize(pageSize: number | undefined): number {
  if (!pageSize || pageSize < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(pageSize, MAX_PAGE_SIZE);
}

/**
 * Normalise an optional string filter value.
 * Returns undefined for null, undefined, or blank/whitespace-only strings so
 * that a blank actor/action/resource is treated as "no filter" rather than
 * matching zero rows in the SP.
 */
export function nz(v: string | null | undefined): string | undefined {
  if (v == null) return undefined;
  const trimmed = v.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Build an AuditFilters bag from:
 *  - `node`    — the resolved scope node (workspaceId from getScopeNode;
 *                scopePath is present in the type but not consumed here)
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
    userId:      nz(filters.actor),
    resource:    nz(filters.resource),
    action:      nz(filters.action),
    resourceId,
    page:        clampPage(filters.page),
    pageSize:    clampPageSize(filters.pageSize),
  };
}
