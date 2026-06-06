import { describe, it, expect, vi, beforeEach } from 'vitest';

const subscribe = vi.fn(() => '<iterator>');
const requireObjectLevel = vi.fn();
const requireWorkspacePermission = vi.fn();

vi.mock('../pubsub.js', () => ({ pubsub: { subscribe } }));
vi.mock('../authz.js', () => ({ requireObjectLevel, requireWorkspacePermission }));

const { taskEventsSubscribe } = await import('../subscriptions/taskEvents.js');
const ctx = { user: { userId: 'U1' } } as any;

describe('taskEventsSubscribe', () => {
  beforeEach(() => { subscribe.mockClear(); requireObjectLevel.mockReset(); requireWorkspacePermission.mockReset(); });

  it('VIEW-gates a projectId scope and subscribes to the prj key', async () => {
    await taskEventsSubscribe({ projectId: 'PRJ-1' }, ctx);
    expect(requireObjectLevel).toHaveBeenCalledWith(ctx, 'SPACE', 'PRJ-1', 'VIEW');
    expect(subscribe).toHaveBeenCalledWith('task:event', 'prj:PRJ-1');
  });

  it('workspace-gates a workspaceId scope and subscribes to the ws key', async () => {
    await taskEventsSubscribe({ workspaceId: 'WS-1' }, ctx);
    expect(requireWorkspacePermission).toHaveBeenCalledWith(ctx, 'WS-1', 'workspace.read');
    expect(subscribe).toHaveBeenCalledWith('task:event', 'ws:WS-1');
  });

  it('throws when neither arg is provided', async () => {
    await expect(taskEventsSubscribe({}, ctx)).rejects.toThrow();
  });
});
