import { describe, it, expect } from 'vitest';
import { criticalPath, baselineDiff, type GanttTaskLike, type GanttEdgeLike } from '../gantt.service.js';
import type { BaselineTask } from '@projectflow/types';

// Helper: a task with a duration (in days) derived from start→due.
function task(id: string, start: string | null, due: string | null): GanttTaskLike {
  return { id, startDate: start, dueDate: due };
}

describe('criticalPath', () => {
  it('returns the longest chain by total duration', () => {
    // A(2d) -> B(5d) -> D(1d) = 8d ;  A(2d) -> C(1d) -> D(1d) = 4d
    const tasks: GanttTaskLike[] = [
      task('A', '2026-06-01', '2026-06-03'), // 2d
      task('B', '2026-06-03', '2026-06-08'), // 5d
      task('C', '2026-06-03', '2026-06-04'), // 1d
      task('D', '2026-06-08', '2026-06-09'), // 1d
    ];
    // edge.dependsOn must finish before edge.taskId.
    const edges: GanttEdgeLike[] = [
      { taskId: 'B', dependsOn: 'A' },
      { taskId: 'C', dependsOn: 'A' },
      { taskId: 'D', dependsOn: 'B' },
      { taskId: 'D', dependsOn: 'C' },
    ];
    expect(criticalPath(tasks, edges)).toEqual(['A', 'B', 'D']);
  });

  it('treats an unscheduled task as zero duration', () => {
    const tasks: GanttTaskLike[] = [
      task('A', '2026-06-01', '2026-06-05'), // 4d
      task('B', null, null),                 // 0d
    ];
    const edges: GanttEdgeLike[] = [{ taskId: 'B', dependsOn: 'A' }];
    expect(criticalPath(tasks, edges)).toEqual(['A', 'B']);
  });

  it('returns the single longest node when there are no edges', () => {
    const tasks: GanttTaskLike[] = [
      task('A', '2026-06-01', '2026-06-02'), // 1d
      task('B', '2026-06-01', '2026-06-10'), // 9d
    ];
    expect(criticalPath(tasks, [])).toEqual(['B']);
  });

  it('returns [] for no tasks', () => {
    expect(criticalPath([], [])).toEqual([]);
  });
});

describe('baselineDiff', () => {
  const captured: BaselineTask[] = [
    { taskId: 'A', startDate: '2026-06-01', dueDate: '2026-06-03' },
    { taskId: 'B', startDate: '2026-06-03', dueDate: '2026-06-08' },
  ];

  it('reports per-task whole-day drift of current vs captured', () => {
    const current = [
      task('A', '2026-06-01', '2026-06-03'), // unchanged
      task('B', '2026-06-05', '2026-06-10'), // +2d on both ends
    ];
    const d = baselineDiff(current, captured);
    expect(d.find((x) => x.taskId === 'A')).toMatchObject({ startDeltaDays: 0, dueDeltaDays: 0, changed: false });
    expect(d.find((x) => x.taskId === 'B')).toMatchObject({ startDeltaDays: 2, dueDeltaDays: 2, changed: true });
  });

  it('omits tasks absent from the baseline', () => {
    const current = [task('C', '2026-06-01', '2026-06-02')];
    expect(baselineDiff(current, captured)).toEqual([]);
  });
});
