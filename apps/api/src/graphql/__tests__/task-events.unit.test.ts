import { describe, it, expect, vi, beforeEach } from 'vitest';

const publish = vi.fn();
const getWorkspaceId = vi.fn();

vi.mock('../pubsub.js', () => ({ pubsub: { publish } }));
vi.mock('../../modules/projects/project.repository.js', () => ({
  ProjectRepository: class { getWorkspaceId = getWorkspaceId; },
}));
vi.mock('../../shared/lib/cache.js', () => ({
  TTL: { LONG: 300 },
  withCache: (_k: string, _t: number, loader: () => Promise<unknown>) => loader(),
}));

const { publishTaskEvent } = await import('../task-events.js');

describe('publishTaskEvent', () => {
  beforeEach(() => { publish.mockReset(); getWorkspaceId.mockReset(); });

  it('publishes to the prefixed project key and the workspace key', async () => {
    getWorkspaceId.mockResolvedValue('WS-1');
    await publishTaskEvent('created', { projectId: 'PRJ-1', task: { id: 'T1' } });

    expect(publish).toHaveBeenCalledWith('task:event', 'prj:PRJ-1',
      { kind: 'created', projectId: 'PRJ-1', task: { id: 'T1' }, taskId: undefined });
    expect(publish).toHaveBeenCalledWith('task:event', 'ws:WS-1',
      { kind: 'created', projectId: 'PRJ-1', task: { id: 'T1' }, taskId: undefined });
  });

  it('skips the workspace publish when the workspace cannot be resolved', async () => {
    getWorkspaceId.mockResolvedValue(null);
    await publishTaskEvent('deleted', { projectId: 'PRJ-2', taskId: 'T2' });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith('task:event', 'prj:PRJ-2',
      { kind: 'deleted', projectId: 'PRJ-2', task: undefined, taskId: 'T2' });
  });
});
