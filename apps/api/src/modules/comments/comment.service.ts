import { CommentRepository } from './comment.repository.js';
import { notificationService } from '../notifications/notification.service.js';
import { fanOutTaskEvent } from '../notifications/fanout.js';
import { watcherService } from '../watchers/watcher.service.js';
import { extractMentionUserIds } from './mentions.js';
import { TaskRepository } from '../tasks/task.repository.js';
import type { Comment, CreateCommentInput } from '@projectflow/types';

const repo     = new CommentRepository();
const taskRepo = new TaskRepository();

export const commentService = {
  async create(input: CreateCommentInput, authorId: string): Promise<Comment> {
    const comment = await repo.create(input, authorId);

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

  delete: (id: string, authorId: string): Promise<boolean> =>
    repo.delete(id, authorId),

  react: (commentId: string, userId: string, emoji: string) =>
    repo.react(commentId, userId, emoji),
};
