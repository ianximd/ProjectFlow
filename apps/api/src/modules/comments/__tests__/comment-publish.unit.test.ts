import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../comment.repository.js', () => ({
  CommentRepository: class {
    create = vi.fn(async (input: any, authorId: string) => ({
      id: 'c1',
      taskId: input.taskId,
      authorId,
      body: input.body,
      createdAt: new Date(),
    }));
    addMention    = vi.fn(async () => false);
    list          = vi.fn(async () => []);
    getById       = vi.fn(async () => null);
    update        = vi.fn(async () => null);
    delete        = vi.fn(async () => false);
    getContext    = vi.fn(async () => null);
    react         = vi.fn(async () => []);
    assign        = vi.fn(async () => null);
    resolve       = vi.fn(async () => null);
  },
}));

vi.mock('../../../graphql/pubsub.js', () => ({
  pubsub: { publish: vi.fn() },
}));

vi.mock('../../notifications/notification.service.js', () => ({
  notificationService: { notify: vi.fn(async () => {}) },
}));

vi.mock('../../notifications/fanout.js', () => ({
  fanOutTaskEvent: vi.fn(async () => {}),
}));

vi.mock('../../watchers/watcher.service.js', () => ({
  watcherService: { add: vi.fn(async () => {}) },
}));

vi.mock('../mentions.js', () => ({
  extractMentionUserIds: vi.fn(() => []),
}));

vi.mock('../../tasks/task.repository.js', () => ({
  TaskRepository: class {
    getById = vi.fn(async () => ({ title: 'Test Task' }));
  },
}));

describe('commentService.create publishes comment:created', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('publishes comment:created with { taskId, comment } after repo.create', async () => {
    const { commentService } = await import('../comment.service.js');
    const { pubsub } = await import('../../../graphql/pubsub.js');

    const comment = await commentService.create(
      { taskId: 't1', body: 'hello', parentId: null } as any,
      'author1',
    );

    expect(pubsub.publish).toHaveBeenCalledWith('comment:created', { taskId: 't1', comment });
  });
});
