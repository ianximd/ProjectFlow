import type { ShareProjection } from '@projectflow/types';

// Keys that expose write affordances — never serve them on a read-only link.
const WRITE_KEYS = new Set(['editUrl', 'actions', 'canEdit', 'mutationUrl', 'assigneeId', 'assignees', 'reporterId']);
// Keys that would let a viewer escape the single shared object — strip all
// parent / sibling / container references so there is no path up the tree.
const NAV_KEYS = new Set([
  'listId', 'folderId', 'spaceId', 'projectId', 'workspaceId',
  'parentTaskId', 'breadcrumb', 'siblings', 'ancestors', 'scopeId', 'scopePath',
]);

function omit(obj: Record<string, unknown>, keys: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (!keys.has(k)) out[k] = v;
  return out;
}

export function stripWrites(payload: Record<string, unknown>): Record<string, unknown> {
  return omit(payload, WRITE_KEYS);
}
export function stripNavigation(payload: Record<string, unknown>): Record<string, unknown> {
  return omit(payload, NAV_KEYS);
}
const readOnly = (p: Record<string, unknown>) => stripNavigation(stripWrites(p));

/** TASK — accepts a mapped camelCase Task (taskRepo.getById) or a raw PascalCase row. */
export function buildTaskProjection(row: Record<string, any>): ShareProjection {
  const r = row ?? {};
  return {
    objectType: 'task',
    objectId:   r.id ?? r.Id,
    level:      'VIEW',
    title:      r.title ?? r.Title ?? '',
    data: readOnly({
      description: r.description ?? r.Description ?? null,
      status:      r.status ?? r.Status ?? null,
      priority:    r.priority ?? r.Priority ?? null,
      dueDate:     r.dueDate ?? r.DueDate ?? null,
    }),
  };
}

/** VIEW (saved view) — accepts a mapped camelCase SavedView (config already an
 *  object) or a raw PascalCase row (Config a JSON string). */
export function buildViewProjection(row: Record<string, any>): ShareProjection {
  const r = row ?? {};
  const rawConfig = r.config ?? r.Config;
  let config: unknown = {};
  if (rawConfig && typeof rawConfig === 'object') config = rawConfig;
  else if (typeof rawConfig === 'string') { try { config = JSON.parse(rawConfig); } catch { config = {}; } }
  return {
    objectType: 'view',
    objectId:   r.id ?? r.Id,
    level:      'VIEW',
    title:      r.name ?? r.Name ?? '',
    data: readOnly({ type: r.type ?? r.Type ?? null, config }),
  };
}

// ── doc / dashboard / whiteboard ─────────────────────────────────────────────
// These modules exist on-disk, but wiring read-only projections for them is a
// documented v1 deferral. resolvePublic returns 404 for these types (it catches
// the throw). Do not stub them as silent empties.
export function buildDocProjection(_row: Record<string, any>): ShareProjection {
  throw new Error('SHARE_OBJECT_TYPE_UNAVAILABLE: doc');
}
export function buildDashboardProjection(_row: Record<string, any>): ShareProjection {
  throw new Error('SHARE_OBJECT_TYPE_UNAVAILABLE: dashboard');
}
export function buildWhiteboardProjection(_row: Record<string, any>): ShareProjection {
  throw new Error('SHARE_OBJECT_TYPE_UNAVAILABLE: whiteboard');
}
