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

const { publishTaskEvent, publishTaskMove } = await import('../task-events.js');

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

describe('publishTaskMove', () => {
  beforeEach(() => { publish.mockReset(); getWorkspaceId.mockReset(); });

  it('same-project move emits a single updated event on the project key', async () => {
    getWorkspaceId.mockResolvedValue(null);
    const task = { id: 'T3', projectId: 'PRJ-1' };
    await publishTaskMove('PRJ-1', task);

    const prjCalls = (publish.mock.calls as unknown[][]).filter(
      ([, key]) => (key as string).startsWith('prj:'),
    );
    expect(prjCalls).toHaveLength(1);
    expect(prjCalls[0]).toEqual([
      'task:event',
      'prj:PRJ-1',
      { kind: 'updated', projectId: 'PRJ-1', task, taskId: undefined },
    ]);
  });

  it('cross-project move emits deleted on the old project and created on the new project', async () => {
    getWorkspaceId.mockResolvedValue(null);
    const task = { id: 'T4', projectId: 'PRJ-NEW' };
    await publishTaskMove('PRJ-OLD', task);

    const prjCalls = (publish.mock.calls as unknown[][]).filter(
      ([, key]) => (key as string).startsWith('prj:'),
    );
    expect(prjCalls).toHaveLength(2);

    const deletedCall = prjCalls.find(([, , payload]) => (payload as { kind: string }).kind === 'deleted');
    expect(deletedCall).toBeDefined();
    expect(deletedCall![1]).toBe('prj:PRJ-OLD');
    expect(deletedCall![2]).toMatchObject({ kind: 'deleted', projectId: 'PRJ-OLD', taskId: 'T4' });

    const createdCall = prjCalls.find(([, , payload]) => (payload as { kind: string }).kind === 'created');
    expect(createdCall).toBeDefined();
    expect(createdCall![1]).toBe('prj:PRJ-NEW');
    expect(createdCall![2]).toMatchObject({ kind: 'created', projectId: 'PRJ-NEW', task });
  });

  it('is a no-op when the task has no projectId', async () => {
    await publishTaskMove('PRJ-OLD', { id: 'T5' });
    expect(publish).not.toHaveBeenCalled();
  });
});
