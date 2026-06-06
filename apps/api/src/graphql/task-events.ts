import { pubsub } from './pubsub.js';
import { withCache, TTL } from '../shared/lib/cache.js';
import { ProjectRepository } from '../modules/projects/project.repository.js';

const projectRepo = new ProjectRepository();

export type TaskEventKind = 'created' | 'updated' | 'deleted';

const projectKey   = (projectId: string)   => `prj:${projectId}`;
const workspaceKey = (workspaceId: string) => `ws:${workspaceId}`;
export const taskEventKey = { project: projectKey, workspace: workspaceKey };

function resolveWorkspaceId(projectId: string): Promise<string | null> {
  return withCache(`project:${projectId}:workspace`, TTL.LONG, () => projectRepo.getWorkspaceId(projectId));
}

/** Best-effort: never throws into the calling mutation. */
export async function publishTaskEvent(
  kind: TaskEventKind,
  args: { projectId: string; task?: unknown; taskId?: string },
): Promise<void> {
  const payload = { kind, projectId: args.projectId, task: args.task, taskId: args.taskId };
  try {
    pubsub.publish('task:event', projectKey(args.projectId), payload);
    const workspaceId = await resolveWorkspaceId(args.projectId);
    if (workspaceId) pubsub.publish('task:event', workspaceKey(workspaceId), payload);
  } catch { /* best-effort */ }
}

/**
 * Move helper: same-project move emits one `updated`; a cross-project move emits
 * `deleted` on the old project + `created` on the new one (so both boards react).
 */
export async function publishTaskMove(oldProjectId: string | null, task: any): Promise<void> {
  const newProjectId = task?.projectId ?? task?.ProjectId;
  if (!newProjectId) return;
  if (oldProjectId && oldProjectId !== newProjectId) {
    await publishTaskEvent('deleted', { projectId: oldProjectId, taskId: task?.id ?? task?.Id });
    await publishTaskEvent('created', { projectId: newProjectId, task });
  } else {
    await publishTaskEvent('updated', { projectId: newProjectId, task });
  }
}
