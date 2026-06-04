import { builder } from './builder.js';
import { watcherService } from '../modules/watchers/watcher.service.js';
import { TaskRepository } from '../modules/tasks/task.repository.js';
import { requireObjectLevel, requireWorkspacePermission } from './authz.js';
import type { TaskWatcher } from '@projectflow/types';

const taskRepo = new TaskRepository();
async function taskListId(taskId: string): Promise<string | null> {
  const t = await taskRepo.getById(taskId);
  return (t as any)?.listId ?? (t as any)?.ListId ?? null;
}

export function registerWatchersGraphql(): void {
  const TaskWatcherType = builder.objectRef<TaskWatcher>('TaskWatcher');
  TaskWatcherType.implement({ fields: (t) => ({
    taskId: t.exposeString('taskId'),
    userId: t.exposeString('userId'),
  }) });

  builder.queryFields((t) => ({
    taskWatchers: t.field({
      type: [TaskWatcherType],
      args: { taskId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireObjectLevel(ctx, 'LIST', await taskListId(a.taskId), 'VIEW');
        return watcherService.list(a.taskId);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    addWatcher: t.field({
      type: 'Boolean',
      args: { taskId: t.arg.string({ required: true }), userId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, await taskRepo.getWorkspaceId(a.taskId), 'task.update');
        await watcherService.add(a.taskId, a.userId); return true;
      },
    }),
    removeWatcher: t.field({
      type: 'Boolean',
      args: { taskId: t.arg.string({ required: true }), userId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, await taskRepo.getWorkspaceId(a.taskId), 'task.update');
        await watcherService.remove(a.taskId, a.userId); return true;
      },
    }),
  }));
}
