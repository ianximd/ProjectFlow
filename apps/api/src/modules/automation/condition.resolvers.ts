/**
 * Real IO-backed resolvers for the two condition kinds that need data:
 *   - ISSUE_MATCHES_FILTER → reuse the PQL parser and match the parsed filter
 *     against the event's task in memory.
 *   - USER_HAS_ROLE        → reuse the roles service (listUserRoles) to check
 *     whether the actor holds a role slug in the rule's workspace.
 */
import { parsePQL, type ParsedPQL } from '../search/pql.parser.js';

/** The subset of a task the PQL matcher inspects. */
export interface FilterTask {
  status?:     string | null;
  priority?:   string | null;
  type?:       string | null;
  assigneeId?: string | null;
  reporterId?: string | null;
  sprintId?:   string | null;
  dueDate?:    string | null;
  title?:      string | null;
}

function eqi(a: unknown, b: unknown): boolean {
  return String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
}

/** Evaluate a ParsedPQL against a task in memory. Every set field must match (AND). */
function matchesParsed(p: ParsedPQL, task: FilterTask): boolean {
  if (p.status   !== undefined && !eqi(task.status,   p.status))   return false;
  if (p.priority !== undefined && !eqi(task.priority, p.priority)) return false;
  if (p.type     !== undefined && !eqi(task.type,     p.type))     return false;
  if (p.assigneeId !== undefined && task.assigneeId !== p.assigneeId) return false;
  if (p.reporterId !== undefined && task.reporterId !== p.reporterId) return false;
  if (p.sprintId   !== undefined && task.sprintId   !== p.sprintId)   return false;
  if (p.q !== undefined && !String(task.title ?? '').toLowerCase().includes(p.q.toLowerCase())) return false;
  if (p.dueAfter  !== undefined) {
    const d = Date.parse(String(task.dueDate));
    if (!Number.isFinite(d) || d < Date.parse(p.dueAfter)) return false;
  }
  if (p.dueBefore !== undefined) {
    const d = Date.parse(String(task.dueDate));
    if (!Number.isFinite(d) || d > Date.parse(p.dueBefore)) return false;
  }
  return true;
}

/** ISSUE_MATCHES_FILTER resolver — true if the task matches the PQL expression. */
export function matchesFilterPQL(pql: string, task: FilterTask, actorId: string | null): boolean {
  if (!pql?.trim()) return true; // an empty filter matches everything
  const parsed = parsePQL(pql, actorId ?? undefined);
  return matchesParsed(parsed, task);
}

/** Shape of one role assignment row we care about (from roleService.listUserRoles). */
interface RoleAssignmentLike { roleSlug: string }

/**
 * Build a USER_HAS_ROLE resolver bound to an actor + workspace. Fails closed
 * (returns false) when there is no actor.
 */
export function makeUserHasRole(
  listUserRoles: (userId: string, workspaceId?: string | null) => Promise<RoleAssignmentLike[]>,
  actorId: string | null,
  workspaceId: string | null,
): (roleSlug: string) => Promise<boolean> {
  return async (roleSlug: string) => {
    if (!actorId) return false;
    const roles = await listUserRoles(actorId, workspaceId);
    return roles.some((r) => r.roleSlug === roleSlug);
  };
}
