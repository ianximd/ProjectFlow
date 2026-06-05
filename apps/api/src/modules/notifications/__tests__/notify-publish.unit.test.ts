import { describe, it, expect, vi, beforeEach } from 'vitest';

const created: any[] = [];
const publish = vi.fn();
const createFn = vi.fn(async (userId: string, type: string, payload: any) => {
  const row = {
    Id: `n-${created.length}`,
    UserId: userId,
    Type: type,
    Payload: JSON.stringify(payload),
    IsRead: false,
    CreatedAt: new Date(),
  };
  created.push(row);
  return row;
});

vi.mock('../notification.repository.js', () => ({
  NotificationRepository: class {
    create = createFn;
  },
}));

vi.mock('../../../graphql/pubsub.js', () => ({
  pubsub: { publish },
}));

beforeEach(() => {
  created.length = 0;
  publish.mockClear();
  createFn.mockClear();
});

describe('notificationService.notify publishes per recipient', () => {
  it('publishes notification:added to each unique recipient (minus actor)', async () => {
    const { notificationService } = await import('../notification.service.js');
    await notificationService.notify({
      recipientIds: ['u1', 'u2', 'actor'],
      actorId: 'actor',
      type: 'MENTION',
      payload: { taskId: 't1' },
    });

    const targets = publish.mock.calls.map((c) => c[1]).sort();
    expect(targets).toEqual(['u1', 'u2']);
    expect(publish.mock.calls[0][0]).toBe('notification:added');
    expect(publish.mock.calls[0][2]).toHaveProperty('notification');
  });
});
