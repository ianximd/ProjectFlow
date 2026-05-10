import { CommentRepository } from './comment.repository.js';
import { notificationService } from '../notifications/notification.service.js';
import { TaskRepository } from '../tasks/task.repository.js';
import type { Comment, CreateCommentInput } from '@projectflow/types';

const repo     = new CommentRepository();
const taskRepo = new TaskRepository();

export const commentService = {
  async create(input: CreateCommentInput, authorId: string): Promise<Comment> {
    const comment = await repo.create(input, authorId);

    // Fire-and-forget notification to task reporter + assignees
    taskRepo.getById(input.taskId).then((task) => {
      if (!task) return;
      const recipients = [task.reporterId, ...(task.assigneeIds ?? [])];
      notificationService.notify({
        recipientIds: recipients,
        actorId: authorId,
        type: 'COMMENT_ADDED',
        payload: {
          taskId:    task.id,
          taskTitle: task.title,
          commentId: comment.id,
        },
      }).catch(() => { /* non-fatal */ });
    }).catch(() => { /* non-fatal */ });

    return comment;
  },

  list: (taskId: string): Promise<Comment[]> =>
    repo.list(taskId),

  getById: (id: string): Promise<Comment | null> =>
    repo.getById(id),

  update: (id: string, body: string, authorId: string): Promise<Comment | null> =>
    repo.update(id, body, authorId),

  delete: (id: string, authorId: string): Promise<boolean> =>
    repo.delete(id, authorId),

  react: (commentId: string, userId: string, emoji: string) =>
    repo.react(commentId, userId, emoji),
};
