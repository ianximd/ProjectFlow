import { builder } from './builder.js';
import { pubsub } from './pubsub.js';
import { requireObjectLevel } from './authz.js';
import { TaskRepository } from '../modules/tasks/task.repository.js';
import { presenceService } from '../modules/presence/presence.service.js';
import type { PresenceUser } from '../modules/presence/presence.viewers.js';

const taskRepo = new TaskRepository();
async function taskListId(taskId: string): Promise<string | null> {
  const t = await taskRepo.getById(taskId);
  return (t as any)?.listId ?? (t as any)?.ListId ?? null;
}

export function registerPresenceGraphql(): void {
  const PresenceUserType = builder.objectRef<PresenceUser>('PresenceUser');
  PresenceUserType.implement({ fields: (t) => ({
    userId:    t.exposeString('userId'),
    name:      t.exposeString('name'),
    avatarUrl: t.exposeString('avatarUrl', { nullable: true }),
    typing:    t.exposeBoolean('typing'),
  }) });

  builder.mutationFields((t) => ({
    presenceHeartbeat: t.field({
      type: [PresenceUserType],
      args: {
        taskId: t.arg.string({ required: true }),
        typing: t.arg.boolean({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        await requireObjectLevel(ctx, 'LIST', await taskListId(a.taskId), 'VIEW');
        const viewers = await presenceService.heartbeat(a.taskId, (ctx.user as any).userId, Boolean(a.typing));
        pubsub.publish('presence:updated', a.taskId, { viewers });
        return viewers as any;
      },
    }),
    presenceLeave: t.field({
      type: [PresenceUserType],
      args: {
        taskId: t.arg.string({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        await requireObjectLevel(ctx, 'LIST', await taskListId(a.taskId), 'VIEW');
        const viewers = await presenceService.leave(a.taskId, (ctx.user as any).userId);
        pubsub.publish('presence:updated', a.taskId, { viewers });
        return viewers as any;
      },
    }),
  }));

  builder.subscriptionFields((t) => ({
    presenceUpdated: t.field({
      type: [PresenceUserType],
      args: {
        taskId: t.arg.string({ required: true }),
      },
      subscribe: async (_, a, ctx) => {
        await requireObjectLevel(ctx, 'LIST', await taskListId(a.taskId), 'VIEW');
        return pubsub.subscribe('presence:updated', a.taskId);
      },
      resolve: (payload: any) => payload.viewers,
    }),
  }));
}
