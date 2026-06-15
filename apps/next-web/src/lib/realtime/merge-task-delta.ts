import type { Task } from '@/server/queries/normalize-task';

/**
 * Per-event task payload shape consumed by `applyTaskEvent` (from the
 * `taskEvents` / `TASK_EVENTS` subscription). Every field beyond `id` is
 * optional and nullable on purpose: the server emits this from several publish
 * sites, at least one of which sends a partial payload (the custom-field
 * value-set path publishes only `{ task: { id } }`). Consumers MUST treat an
 * absent/null field as "unchanged", never "cleared".
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
  startDate?: string | null;
  dueDate?: string | null;
  sprintId?: string | null;
  updatedAt?: string | null;
}

/**
 * Merge a partial task delta into a Task[] by id.
 *
 * Role: called by `applyTaskEvent` for the `updated` kind and for the
 * own-optimistic-`created` path (where the locally-created task is already
 * present and only needs its server fields merged in). Add and hard-remove
 * operations are handled entirely in `applyTaskEvent`; this function is
 * id-keyed field-merge only.
 *
 * Behaviour when id is unknown: the original array reference is returned
 * unchanged (same ref → React skips re-render). This is correct for
 * `applyTaskEvent`'s `updated` path — an event for a task not currently in
 * view is silently dropped.
 *
 * Fields merge DEFENSIVELY — only a non-null delta value overwrites the
 * current one, so a partial payload (e.g. the custom-field publish site emits
 * only `{ id }`) can never blank an existing title/status. `position` is
 * intentionally not touched (the GraphQL Task carries none; ordering stays
 * local/optimistic). Channel scoping (keyed `task:event` / `prj:`/`ws:`
 * prefixes) is handled upstream in `taskEventsSubscribe`; by the time this
 * function is called the event is already confirmed to belong to the active
 * view.
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
      ...(delta.startDate   != null ? { startDate:   delta.startDate }   : {}),
      ...(delta.dueDate     != null ? { dueDate:     delta.dueDate }     : {}),
      ...(delta.sprintId    != null ? { sprintId:    delta.sprintId }    : {}),
    };
  });
  return matched ? next : tasks;
}
