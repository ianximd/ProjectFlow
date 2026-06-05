import type { Task } from '@/server/queries/normalize-task';

/**
 * The camelCase fields carried by the `taskUpdated` GraphQL subscription
 * (`TASK_UPDATED` in ./operations). Every field beyond `id` is optional and
 * nullable on purpose: the server emits this from several publish sites, at
 * least one of which sends a partial payload (the custom-field value-set path
 * publishes only `{ task: { id } }`). Consumers MUST treat an absent/null field
 * as "unchanged", never "cleared".
 */
export interface TaskDelta {
  id: string;
  projectId?: string | null;
  issueKey?: string | null;
  title?: string | null;
  status?: string | null;
  priority?: string | null;
  type?: string | null;
  storyPoints?: number | null;
  dueDate?: string | null;
  sprintId?: string | null;
  updatedAt?: string | null;
}

/**
 * Apply a live `taskUpdated` delta onto a board task list, in place by id.
 *
 * Scope (v1): UPDATE-ONLY. A delta whose id isn't already shown is ignored — no
 * live add/remove (see DECISIONS §3.5b follow-ups). That also makes the merge
 * correct-by-construction for the active project: the board only holds that
 * project's tasks, so an id match can only be one of them, and the global
 * `task:updated` channel's cross-project chatter is dropped here.
 *
 * Fields merge DEFENSIVELY — only a non-null delta value overwrites the current
 * one, so a partial payload can never blank an existing title/status. `position`
 * is intentionally not touched (the GraphQL Task carries none; ordering stays
 * local/optimistic). The original array reference is returned unchanged when no
 * task matched, so React can skip a re-render.
 */
export function mergeTaskDelta(tasks: Task[], delta: TaskDelta): Task[] {
  let matched = false;
  const next = tasks.map((task) => {
    if (task.id !== delta.id) return task;
    matched = true;
    return {
      ...task,
      ...(delta.issueKey    != null ? { issueKey:    delta.issueKey }    : {}),
      ...(delta.title       != null ? { title:       delta.title }       : {}),
      ...(delta.status      != null ? { status:      delta.status }      : {}),
      ...(delta.priority    != null ? { priority:    delta.priority }    : {}),
      ...(delta.type        != null ? { type:        delta.type }        : {}),
      ...(delta.storyPoints != null ? { storyPoints: delta.storyPoints } : {}),
      ...(delta.dueDate     != null ? { dueDate:     delta.dueDate }     : {}),
      ...(delta.sprintId    != null ? { sprintId:    delta.sprintId }    : {}),
    };
  });
  return matched ? next : tasks;
}
