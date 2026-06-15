/**
 * Phase 9f — Chat view GraphQL surface.
 *
 * A thin mirror over `commentService`: the chat channel for a task IS its
 * comment thread. All side-effects (mentions, watcher fan-out, realtime
 * publish, automation) live inside `commentService.create`, so this schema
 * only adds the authz gate and exposes the {id,taskId,authorId,body,createdAt}
 * shape the chat UI reads.
 *
 * Authz mirrors the REST/GraphQL comment routes:
 *   - chatChannel (read)    → requireObjectLevel(ctx, 'LIST', listId, 'VIEW')
 *   - postChatMessage (write)→ requireWorkspacePermission(ctx, workspaceId, 'comment.create')
 */
import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { commentService } from '../modules/comments/comment.service.js';
import { TaskRepository } from '../modules/tasks/task.repository.js';
import { requireObjectLevel, requireWorkspacePermission } from './authz.js';
import type { Comment } from '@projectflow/types';

const taskRepo = new TaskRepository();

/** Resolve the List a task lives in (object-level ACL anchor). usp_Task_GetById
 *  returns SELECT * (PascalCase); read both casings defensively. */
async function taskListId(taskId: string): Promise<string | null> {
  const t = await taskRepo.getById(taskId);
  return (t as any)?.listId ?? (t as any)?.ListId ?? null;
}

export function registerChatGraphql(): void {
  const ChatMessageType = builder.objectRef<Comment>('ChatMessage');
  ChatMessageType.implement({ fields: (t) => ({
    id:        t.exposeString('id'),
    taskId:    t.exposeString('taskId'),
    authorId:  t.exposeString('authorId'),
    body:      t.exposeString('body'),
    // Matches the registered 'Date' scalar pattern used by CommentType /
    // AuditLogEntry — serialize the timestamp through a JS Date.
    createdAt: t.field({ type: 'Date', resolve: (c) => new Date(c.createdAt) }),
  }) });

  builder.queryFields((t) => ({
    chatChannel: t.field({
      type: [ChatMessageType],
      args: { taskId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const workspaceId = await taskRepo.getWorkspaceId(a.taskId);
        if (!workspaceId) throw new GraphQLError('Task not found', { extensions: { code: 'NOT_FOUND' } });
        await requireObjectLevel(ctx, 'LIST', await taskListId(a.taskId), 'VIEW');
        return commentService.list(a.taskId);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    postChatMessage: t.field({
      type: ChatMessageType,
      args: { taskId: t.arg.string({ required: true }), body: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
        const workspaceId = await taskRepo.getWorkspaceId(a.taskId);
        if (!workspaceId) throw new GraphQLError('Task not found', { extensions: { code: 'NOT_FOUND' } });
        await requireWorkspacePermission(ctx, workspaceId, 'comment.create');
        if (!a.body.trim()) throw new GraphQLError('body is required', { extensions: { code: 'BAD_REQUEST' } });
        return commentService.create({ taskId: a.taskId, body: a.body, parentId: null }, (ctx.user as any).userId);
      },
    }),
  }));
}
