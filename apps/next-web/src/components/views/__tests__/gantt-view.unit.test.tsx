import { describe, it, expect } from 'vitest';
import { barGeometry, lanePath, dayIndex } from '../gantt-geom';

describe('gantt geometry', () => {
  const origin = '2026-06-01';
  it('maps a date to a whole-day column index from the origin', () => {
    expect(dayIndex(origin, '2026-06-01')).toBe(0);
    expect(dayIndex(origin, '2026-06-04')).toBe(3);
  });
  it('computes a bar x/width from start/due in day-columns', () => {
    const g = barGeometry(origin, '2026-06-03', '2026-06-08', 24); // 24px/day
    expect(g.x).toBe(2 * 24);                       // starts on day index 2
    expect(g.width).toBe(Math.max(24, 5 * 24));     // 5-day span, min one column
  });
  it('returns a zero-width hidden bar for an unscheduled task', () => {
    const g = barGeometry(origin, null, null, 24);
    expect(g.hidden).toBe(true);
  });
  it('builds an elbow connector path between two bar endpoints', () => {
    const d = lanePath({ x: 10, y: 5 }, { x: 80, y: 35 });
    expect(typeof d).toBe('string');
    expect(d.startsWith('M')).toBe(true);
  });
});
