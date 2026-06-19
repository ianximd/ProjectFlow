import { CommentRepository } from './comment.repository.js';
import { notificationService } from '../notifications/notification.service.js';
import { fanOutTaskEvent } from '../notifications/fanout.js';
import { watcherService } from '../watchers/watcher.service.js';
import { extractMentionUserIds } from './mentions.js';
import { TaskRepository } from '../tasks/task.repository.js';
import { pubsub } from '../../graphql/pubsub.js';
import { emitAutomationEvent } from '../automation/automation.bus.js';
import { aiIndexService } from '../ai/index/ai-index.service.js';
import type { Comment, CreateCommentInput } from '@projectflow/types';

const repo     = new CommentRepository();
const taskRepo = new TaskRepository();

export const commentService = {
  async create(input: CreateCommentInput, authorId: string): Promise<Comment> {
    const comment = await repo.create(input, authorId);

    try { pubsub.publish('comment:created', { taskId: comment.taskId, comment }); } catch { /* best-effort */ }

    // Side-effects: fire-and-forget so the mutation isn't blocked.
    void (async () => {
      const task = await taskRepo.getById(comment.taskId);
      if (!task) return;
      const taskTitle = (task as any).title ?? (task as any).Title ?? '';

      // Author auto-watches the task (ClickUp behavior).
      await watcherService.add(comment.taskId, authorId).catch(() => {});

      // Mentions: idempotent insert; only genuinely-new mentions notify + auto-watch.
      const mentioned = extractMentionUserIds(comment.body);
      const newlyNotified: string[] = [];
      for (const uid of mentioned) {
        const wasNew = await repo.addMention(comment.id, uid).catch(() => false);
        if (!wasNew) continue;
        newlyNotified.push(uid);
        await watcherService.add(comment.taskId, uid).catch(() => {});
        await notificationService.notify({
          recipientIds: [uid], actorId: authorId, type: 'MENTION',
          payload: { taskId: comment.taskId, taskTitle, commentId: comment.id },
        }).catch(() => {});
      }

      // COMMENT_ADDED to reporter + assignees + watchers (minus actor, minus
      // users we just sent a MENTION to — avoids double-notifying).
      await fanOutTaskEvent(
        comment.taskId, authorId, 'COMMENT_ADDED',
        { taskId: comment.taskId, taskTitle, commentId: comment.id },
        newlyNotified,
      );

      const projectId   = (task as any).projectId   ?? (task as any).ProjectId   ?? null;
      const workspaceId = (task as any).workspaceId ?? (task as any).WorkspaceId ?? null;
      if (projectId && workspaceId) {
        void emitAutomationEvent({
          type: 'COMMENT_POSTED', workspaceId, projectId,
          taskId: comment.taskId, actorId: authorId, commentId: comment.id,
        });
      }

      // AI index (Phase 11a): index the comment body. Fire-and-forget; resolves
      // its own LIST scope through the parent task in the worker.
      if (workspaceId) {
        void aiIndexService.enqueueIndex(workspaceId, 'comment', comment.id);
      }
    })().catch(() => { /* non-fatal */ });

    return comment;
  },

  list: (taskId: string): Promise<Comment[]> =>
    repo.list(taskId),

  getById: (id: string): Promise<Comment | null> =>
    repo.getById(id),

  async update(id: string, body: string, authorId: string): Promise<Comment | null> {
    const comment = await repo.update(id, body, authorId);
    if (!comment) return null;

    // Edits can introduce NEW mentions. The CommentMentions PK makes inserts
    // idempotent, so already-mentioned users return wasNew=false and are NOT
    // re-notified. No COMMENT_ADDED on edit.
    void (async () => {
      const task = await taskRepo.getById(comment.taskId);
      if (!task) return;
      const taskTitle = (task as any).title ?? (task as any).Title ?? '';
      for (const uid of extractMentionUserIds(comment.body)) {
        const wasNew = await repo.addMention(comment.id, uid).catch(() => false);
        if (!wasNew) continue;
        await watcherService.add(comment.taskId, uid).catch(() => {});
        await notificationService.notify({
          recipientIds: [uid], actorId: authorId, type: 'MENTION',
          payload: { taskId: comment.taskId, taskTitle, commentId: comment.id },
        }).catch(() => {});
      }

      // AI index (Phase 11a): the body changed — re-index. Fire-and-forget.
      const workspaceId = (task as any).workspaceId ?? (task as any).WorkspaceId ?? null;
      if (workspaceId) void aiIndexService.enqueueIndex(workspaceId, 'comment', comment.id);
    })().catch(() => {});

    return comment;
  },

  async assign(commentId: string, assigneeId: string, actorId: string): Promise<Comment | null> {
    const comment = await repo.assign(commentId, assigneeId, actorId);
    if (!comment) return null;
    void (async () => {
      await watcherService.add(comment.taskId, assigneeId).catch(() => {});
      const task = await taskRepo.getById(comment.taskId);
      const taskTitle = (task as any)?.title ?? (task as any)?.Title ?? '';
      await notificationService.notify({
        recipientIds: [assigneeId], actorId, type: 'COMMENT_ASSIGNED',
        payload: { taskId: comment.taskId, taskTitle, commentId: comment.id },
      }).catch(() => {});
    })().catch(() => {});
    return comment;
  },

  resolve: (commentId: string, actorId: string, resolved: boolean): Promise<Comment | null> =>
    repo.resolve(commentId, actorId, resolved),

  async delete(id: string, authorId: string): Promise<boolean> {
    // Resolve the comment's workspace BEFORE the delete so we can tombstone its
    // chunks. getContext reads the comment→task→workspace anchor.
    const ctx = await repo.getContext(id).catch(() => null);
    const ok = await repo.delete(id, authorId);
    if (ok && ctx?.workspaceId) {
      // AI index (Phase 11a): tombstone the deleted comment's chunks. Fire-and-forget.
      void aiIndexService.enqueueDelete(ctx.workspaceId, 'comment', id);
    }
    return ok;
  },

  react: (commentId: string, userId: string, emoji: string) =>
    repo.react(commentId, userId, emoji),
};
