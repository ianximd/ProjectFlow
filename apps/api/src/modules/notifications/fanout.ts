import { TaskRepository } from '../tasks/task.repository.js';
import { watcherService } from '../watchers/watcher.service.js';
import { notificationService } from './notification.service.js';
import { getRedis } from '../../shared/lib/redis.js';
import { subLogger } from '../../shared/lib/logger.js';

const log = subLogger('fanout');
const taskRepo = new TaskRepository();

/** Normalize a GUID to uppercase for case-insensitive set membership. */
const norm = (id: string | null | undefined): string | null => (id ? id.toUpperCase() : null);

/**
 * Pure recipient computation: union(reporter, assignees, watchers) minus the
 * actor and any extraExclude ids, deduped case-insensitively (uppercased).
 */
export function computeRecipients(args: {
  reporterId: string | null;
  assigneeIds: string[];
  watcherIds: string[];
  actorId: string;
  extraExclude?: string[];
}): string[] {
  const set = new Set<string>();
  const add = (id: string | null) => { const n = norm(id); if (n) set.add(n); };
  add(args.reporterId);
  args.assigneeIds.forEach(add);
  args.watcherIds.forEach(add);
  set.delete(norm(args.actorId)!);
  for (const ex of args.extraExclude ?? []) set.delete(norm(ex)!);
  return [...set];
}

/**
 * Notify everyone watching/reporting/assigned to a task about an event,
 * excluding the actor. Fire-and-forget; never throws.
 */
export async function fanOutTaskEvent(
  taskId: string,
  actorId: string,
  type: string,
  payload: Record<string, unknown>,
  extraExclude: string[] = [],
): Promise<void> {
  try {
    const [task, watchers] = await Promise.all([
      taskRepo.getById(taskId),
      watcherService.list(taskId),
    ]);
    if (!task) return;
    // usp_Task_GetById is `SELECT * FROM Tasks`, so the row is raw PascalCase
    // (ReporterId) and carries NO assignees (those live in a join table). Read
    // the reporter via PascalCase (camelCase fallback for any mapped caller).
    // Assignees are covered by the watcher path: assignment auto-watches the
    // task (task.service.setAssignees), so current assignees appear in
    // `watcherIds`. `assigneeIds` is therefore best-effort and normally empty.
    const recipientIds = computeRecipients({
      reporterId: (task as any).reporterId ?? (task as any).ReporterId ?? null,
      assigneeIds: (task as any).assigneeIds ?? (task as any).AssigneeIds ?? [],
      watcherIds: watchers.map((w) => w.userId),
      actorId,
      extraExclude,
    });
    if (recipientIds.length === 0) return;
    // recipientIds are uppercased by computeRecipients; normalize actorId to the
    // same case so notify()'s own self-exclusion guard stays effective.
    await notificationService.notify({ recipientIds, actorId: norm(actorId) ?? actorId, type, payload });
  } catch (err: any) {
    log.error({ err: err?.message, taskId, type }, 'fanOutTaskEvent failed');
  }
}

/**
 * Returns true at most once per `ttlSeconds` for a given key (Redis SET NX EX).
 * Fails OPEN (returns true) if Redis is unavailable — better to notify than to
 * silently drop. Used to coalesce noisy TASK_UPDATED bursts.
 */
export async function debounceGate(key: string, ttlSeconds: number): Promise<boolean> {
  try {
    const res = await getRedis().set(key, '1', 'EX', ttlSeconds, 'NX');
    return res === 'OK';
  } catch {
    return true;
  }
}
