import { normalizeTask, type Task } from '@/server/queries/normalize-task';
import { mergeTaskDelta, type TaskDelta } from './merge-task-delta';

export interface LiveTask extends TaskDelta {
  listId?: string | null;
  customFieldValues?: string | null;
  assignees?: Array<{ userId: string; name: string | null; email: string | null; avatarUrl: string | null }> | null;
}

export interface TaskEvent {
  kind: 'created' | 'updated' | 'deleted';
  taskId?: string | null; // present only on `deleted` events
  task?: LiveTask | null; // present on `created` and `updated` events
}

/** GraphQL full-task payload → client Task (normalizeTask is casing-tolerant). */
export function mapLiveTask(raw: LiveTask): Task {
  return normalizeTask(raw);
}

export function applyTaskEvent(
  tasks: Task[],
  ev: TaskEvent,
  accepts: (task: Task) => boolean,
): Task[] {
  if (ev.kind === 'deleted') {
    if (!ev.taskId) return tasks;
    const next = tasks.filter((t) => t.id !== ev.taskId);
    return next.length === tasks.length ? tasks : next;
  }
  if (!ev.task) return tasks;
  if (ev.kind === 'updated') {
    // `accepts` is intentionally not consulted: updates only touch tasks already in view.
    return mergeTaskDelta(tasks, ev.task as TaskDelta);
  }
  // created
  if (tasks.some((t) => t.id === ev.task!.id)) {
    return mergeTaskDelta(tasks, ev.task as TaskDelta); // already shown (own optimistic) → merge
  }
  const mapped = mapLiveTask(ev.task);
  return accepts(mapped) ? [...tasks, mapped] : tasks;
}
