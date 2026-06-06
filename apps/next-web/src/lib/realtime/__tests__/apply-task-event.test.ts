import { describe, it, expect } from 'vitest';
import { applyTaskEvent, type TaskEvent } from '../apply-task-event';
import type { Task } from '@/server/queries/normalize-task';

const base: Task[] = [{ id: 'A', listId: 'L1', title: 'A', status: 'todo' } as Task];
const ev = (e: Partial<TaskEvent>): TaskEvent => ({ kind: 'updated', ...e } as TaskEvent);

describe('applyTaskEvent', () => {
  it('updated: merges fields by id', () => {
    const out = applyTaskEvent(base, ev({ kind: 'updated', task: { id: 'A', title: 'A2' } }), () => true);
    expect(out[0].title).toBe('A2');
  });

  it('deleted: removes by id', () => {
    const out = applyTaskEvent(base, ev({ kind: 'deleted', taskId: 'A' }), () => true);
    expect(out).toHaveLength(0);
  });

  it('deleted: unknown id is a no-op (same ref)', () => {
    const out = applyTaskEvent(base, ev({ kind: 'deleted', taskId: 'Z' }), () => true);
    expect(out).toBe(base);
  });

  it('created: appends when accepts() passes and id is new', () => {
    const out = applyTaskEvent(base, ev({ kind: 'created', task: { id: 'B', listId: 'L1', title: 'B' } }), () => true);
    expect(out.map((t) => t.id)).toEqual(['A', 'B']);
  });

  it('created: rejected by accepts() is a no-op (same ref)', () => {
    const out = applyTaskEvent(base, ev({ kind: 'created', task: { id: 'B', listId: 'L9', title: 'B' } }), (t) => t.listId === 'L1');
    expect(out).toBe(base);
  });

  it('created: known id (own optimistic) merges instead of duplicating', () => {
    const out = applyTaskEvent(base, ev({ kind: 'created', task: { id: 'A', title: 'A3' } }), () => true);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('A3');
  });
});
