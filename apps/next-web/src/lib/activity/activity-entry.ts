import type { AuditLogEntry } from '@projectflow/types';
import type { TaskEvent } from '@/lib/realtime/apply-task-event';

// ── Live task event → AuditLogEntry conversion ───────────────────────────────
// The Activity view receives AuditLogEntry[] SSR (from getActivityFeed) and then
// live-prepends synthetic entries built from the TASK_EVENTS subscription, so
// the feed stays fresh without a full SSR re-seed on every task mutation.

/** Map a TaskEvent's `kind` to the AuditLogEntry `action` verb. */
export const KIND_ACTION: Record<TaskEvent['kind'], string> = {
  created: 'CREATE',
  updated: 'UPDATE',
  deleted: 'DELETE',
};

/** Convert a live TaskEvent into a synthetic AuditLogEntry.
 *  Returns null when the event carries no usable task id (guard against
 *  malformed payloads — the caller should skip null entries). */
export function taskEventToEntry(ev: TaskEvent): AuditLogEntry | null {
  const resourceId = ev.task?.id ?? ev.taskId ?? null;
  if (!resourceId) return null;

  return {
    id:          `live-${ev.kind}-${resourceId}-${Date.now()}`,
    workspaceId: null,
    userId:      '',        // actor unknown client-side — the view shows "live" badge
    userEmail:   null,
    action:      KIND_ACTION[ev.kind],
    resource:    'Task',
    resourceId,
    oldValues:   null,
    newValues:   ev.task
      ? { id: ev.task.id, title: (ev.task as { title?: string | null }).title ?? null }
      : null,
    ipAddress:   null,
    userAgent:   null,
    createdAt:   new Date().toISOString(),
  };
}

/** Prepend a new entry to the front of the feed, de-duplicating by `id` and
 *  capping the total at 200 to avoid unbounded growth during long sessions.
 *  Returns a NEW array — the original is never mutated. */
export function prependEntry(
  feed: AuditLogEntry[],
  entry: AuditLogEntry,
): AuditLogEntry[] {
  const deduped = feed.filter((e) => e.id !== entry.id);
  const next = [entry, ...deduped];
  return next.length > 200 ? next.slice(0, 200) : next;
}
