import { describe, it, expect } from 'vitest';
import { normalizeTask } from '../normalize-task';

describe('normalizeTask', () => {
  it('reads PascalCase', () => {
    const t = normalizeTask({ Id: 't1', Title: 'A', Status: 'To Do', Priority: 'High', Type: 'TASK' });
    expect(t).toMatchObject({ id: 't1', title: 'A', status: 'To Do', priority: 'High', type: 'TASK' });
  });
  it('reads camelCase and defaults', () => {
    const t = normalizeTask({ id: 't2' });
    expect(t).toMatchObject({ id: 't2', title: '(untitled)', status: 'To Do', priority: 'Medium', type: 'TASK' });
  });
});
