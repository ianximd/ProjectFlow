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

/** Build the evaluation context. workspaceId/actorId fall back to the payload
 *  but the worker SHOULD pass the authoritative ones via opts. */
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
