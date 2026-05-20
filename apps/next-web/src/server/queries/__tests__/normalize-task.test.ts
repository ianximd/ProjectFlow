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
  it('maps PascalCase ResolvedAt to resolvedAt', () => {
    const t = normalizeTask({ Id: 't1', ResolvedAt: '2026-05-20T00:00:00.000Z' });
    expect(t.resolvedAt).toBe('2026-05-20T00:00:00.000Z');
  });
  it('yields null resolvedAt when ResolvedAt is absent', () => {
    const t = normalizeTask({ Id: 't3' });
    expect(t.resolvedAt).toBeNull();
  });
});
