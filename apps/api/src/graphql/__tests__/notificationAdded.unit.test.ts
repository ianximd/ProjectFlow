import { describe, it, expect, vi } from 'vitest';

const subscribe = vi.fn((_channel: string, _userId: string) => (async function* () {})());

vi.mock('../pubsub.js', () => ({ pubsub: { subscribe, publish: vi.fn() } }));

const { notificationAddedSubscribe } = await import('../subscriptions/notificationAdded.js');

describe('notificationAdded subscribe', () => {
  it('binds to the authenticated user id, ignoring the client arg', () => {
    const ctx = { user: { userId: 'real-user' } } as any;
    notificationAddedSubscribe(null, { userId: 'someone-else' }, ctx);
    expect(subscribe).toHaveBeenCalledWith('notification:added', 'real-user');
  });

  it('throws when unauthenticated', () => {
    expect(() => notificationAddedSubscribe(null, {}, { user: null } as any)).toThrow();
  });
});
