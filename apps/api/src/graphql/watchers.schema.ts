import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { watcherService } from '../modules/watchers/watcher.service.js';
import type { TaskWatcher } from '@projectflow/types';

function requireAuth(ctx: { user: unknown }): asserts ctx is { user: { userId: string } } {
  if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
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
      resolve: async (_, a, ctx) => { requireAuth(ctx); return watcherService.list(a.taskId); },
    }),
  }));

  builder.mutationFields((t) => ({
    addWatcher: t.field({
      type: 'Boolean',
      args: { taskId: t.arg.string({ required: true }), userId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => { requireAuth(ctx); await watcherService.add(a.taskId, a.userId); return true; },
    }),
    removeWatcher: t.field({
      type: 'Boolean',
      args: { taskId: t.arg.string({ required: true }), userId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => { requireAuth(ctx); await watcherService.remove(a.taskId, a.userId); return true; },
    }),
  }));
}
