import { describe, it, expect } from 'vitest';
import { mergeTaskDelta, type TaskDelta } from '../merge-task-delta';
import type { Task } from '@/server/queries/normalize-task';

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    projectId: null,
    listId: null,
    issueKey: 'PF-1',
    title: 'Original title',
    description: null,
    status: 'To Do',
    priority: 'Medium',
    type: 'TASK',
    storyPoints: null,
    startDate: null,
    dueDate: null,
    resolvedAt: null,
    position: 3,
    sprintId: null,
    customFieldValues: {},
    assignees: [],
    ...overrides,
  };
}

describe('mergeTaskDelta', () => {
  it('merges non-null delta fields onto the matching task', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b', title: 'B' })];
    const delta: TaskDelta = { id: 'b', title: 'B updated', status: 'In Progress', priority: 'High' };

    const next = mergeTaskDelta(tasks, delta);

    expect(next[1]).toMatchObject({ id: 'b', title: 'B updated', status: 'In Progress', priority: 'High' });
    expect(next[0]).toBe(tasks[0]); // untouched tasks keep identity
  });

  it('ignores a delta whose id is not present (returns same array reference)', () => {
    const tasks = [task({ id: 'a' })];
    const next = mergeTaskDelta(tasks, { id: 'zzz', title: 'ghost' });
    expect(next).toBe(tasks);
  });

  it('treats null/absent fields as unchanged — never blanks existing values', () => {
    const tasks = [task({ id: 'a', title: 'Keep me', status: 'Done' })];
    // Partial payload (e.g. custom-field value-set publishes only the id).
    const next = mergeTaskDelta(tasks, { id: 'a', title: null, status: undefined as unknown as null });
    expect(next[0]).toMatchObject({ title: 'Keep me', status: 'Done' });
  });

  it('does not touch position (ordering stays local/optimistic)', () => {
    const tasks = [task({ id: 'a', position: 7 })];
    const next = mergeTaskDelta(tasks, { id: 'a', title: 'new', status: 'Done' });
    expect(next[0].position).toBe(7);
  });

  it('applies storyPoints/dueDate/sprintId/type/issueKey when present', () => {
    const tasks = [task({ id: 'a' })];
    const delta: TaskDelta = {
      id: 'a', issueKey: 'PF-99', type: 'BUG', storyPoints: 5,
      dueDate: '2026-07-01T00:00:00.000Z', sprintId: 'sprint-1',
    };
    const next = mergeTaskDelta(tasks, delta);
    expect(next[0]).toMatchObject({
      issueKey: 'PF-99', type: 'BUG', storyPoints: 5,
      dueDate: '2026-07-01T00:00:00.000Z', sprintId: 'sprint-1',
    });
  });
});
