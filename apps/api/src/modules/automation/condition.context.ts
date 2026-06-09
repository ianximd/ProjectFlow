/**
 * Build a ConditionContext from a 6a automation event payload, binding the real
 * PQL-filter and RBAC role resolvers. Keeps the pure tree evaluator IO-free.
 *
 * NOTE: the 6a payload carries actorId + event field deltas but NOT workspaceId;
 * the worker passes the authoritative workspaceId (job.data.workspaceId) via opts
 * so USER_HAS_ROLE is scoped to the rule's workspace.
 */
import type { ConditionContext } from './condition.tree.js';
import { matchesFilterPQL, makeUserHasRole, type FilterTask } from './condition.resolvers.js';
import { roleService } from '../roles/role.service.js';

/** The slice of the 6a job payload the condition engine reads. */
export interface AutomationEventPayload {
  taskId?:      string;
  actorId?:     string | null;
  status?:      string | null;
  toStatus?:    string | null;
  priority?:    string | null;
  type?:        string | null;
  assigneeId?:  string | null;
  reporterId?:  string | null;
  sprintId?:    string | null;
  dueDate?:     string | null;
  storyPoints?: number | null;
  title?:       string | null;
  fromStatus?:  string | null;
  field?:       string | null;
  from?:        unknown;
  to?:          unknown;
  [key: string]: unknown;
}

/** Flatten the payload into the field map the FIELD leaves read.
 *  Explicit normalised defaults first, then spread the raw payload so any other
 *  field name a user typed is also available (raw value wins when present). */
export function toConditionFields(p: AutomationEventPayload): Record<string, unknown> {
  return {
    status:      p.status      ?? p.toStatus ?? null,
    priority:    p.priority    ?? null,
    type:        p.type        ?? null,
    assigneeId:  p.assigneeId  ?? null,
    reporterId:  p.reporterId  ?? null,
    sprintId:    p.sprintId    ?? null,
    dueDate:     p.dueDate     ?? null,
    storyPoints: p.storyPoints ?? null,
    title:       p.title       ?? null,
    fromStatus:  p.fromStatus  ?? null,
    field:       p.field       ?? null,
    from:        p.from        ?? null,
    to:          p.to          ?? null,
    ...p,
  };
}

export function toFilterTask(p: AutomationEventPayload): FilterTask {
  return {
    status:     p.status     ?? p.toStatus ?? null,
    priority:   p.priority   ?? null,
    type:       p.type       ?? null,
    assigneeId: p.assigneeId ?? null,
    reporterId: p.reporterId ?? null,
    sprintId:   p.sprintId   ?? null,
    dueDate:    p.dueDate     ?? null,
    title:      p.title       ?? null,
  };
}

/**
 * Convert a raw DB task row (PascalCase from `SELECT *` or camelCase from the
 * TS type) into a partial AutomationEventPayload so scheduler-origin jobs can
 * hydrate the condition evaluation with the task's CURRENT field values.
 *
 * Casing-tolerant: reads `(row as any).status ?? (row as any).Status` etc.
 * `assigneeId` is resolved from assigneeIds/AssigneeIds which may be an array
 * or a comma-separated string; only the FIRST id is taken.
 * Returns `{}` for null/undefined input.
 */
export function taskToPayloadFields(task: unknown): Partial<AutomationEventPayload> {
  if (task == null) return {};
  const r = task as Record<string, unknown>;

  // Resolve assigneeId: array or comma-string → first element
  const rawAssignees = r['assigneeIds'] ?? r['AssigneeIds'];
  let assigneeId: string | null = null;
  if (Array.isArray(rawAssignees) && rawAssignees.length > 0) {
    assigneeId = String(rawAssignees[0]);
  } else if (typeof rawAssignees === 'string' && rawAssignees.length > 0) {
    assigneeId = rawAssignees.split(',')[0].trim() || null;
  }

  return {
    status:      (r['status']      ?? r['Status']      ?? null) as string | null,
    priority:    (r['priority']    ?? r['Priority']    ?? null) as string | null,
    type:        (r['type']        ?? r['Type']        ?? null) as string | null,
    assigneeId,
    reporterId:  (r['reporterId']  ?? r['ReporterId']  ?? null) as string | null,
    sprintId:    (r['sprintId']    ?? r['SprintId']    ?? null) as string | null,
    dueDate:     (r['dueDate']     ?? r['DueDate']     ?? null) as string | null,
    storyPoints: (r['storyPoints'] ?? r['StoryPoints'] ?? null) as number | null,
    title:       (r['title']       ?? r['Title']       ?? null) as string | null,
  };
}

/** Build the evaluation context. The worker passes the authoritative workspaceId
 *  (job.data.workspaceId) + actorId via opts; actorId falls back to the payload,
 *  workspaceId falls back to null (the 6a payload carries no workspaceId). */
export function buildConditionContext(
  payload: AutomationEventPayload,
  opts: { workspaceId?: string | null; actorId?: string | null } = {},
): ConditionContext {
  const actorId     = opts.actorId     ?? (payload.actorId as string | null | undefined) ?? null;
  const workspaceId = opts.workspaceId ?? null;
  const filterTask  = toFilterTask(payload);

  return {
    fields:        toConditionFields(payload),
    matchesFilter: async (pql) => matchesFilterPQL(pql, filterTask, actorId),
    userHasRole:   makeUserHasRole(roleService.listUserRoles, actorId, workspaceId),
  };
}
