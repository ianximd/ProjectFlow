import { describe, it, expect } from 'vitest';
import {
  shouldAutoStart, shouldAutoComplete, nextSprintWindow, selectRollForwardTasks,
} from '../sprint.cadence.js';

const d = (s: string) => new Date(s);

describe('shouldAutoStart', () => {
  it('starts a PLANNED sprint once its StartDate has arrived', () => {
    expect(shouldAutoStart({ status: 'PLANNED', startDate: d('2026-07-01T00:00:00Z') }, d('2026-07-01T06:00:00Z'))).toBe(true);
  });
  it('does not start before StartDate', () => {
    expect(shouldAutoStart({ status: 'PLANNED', startDate: d('2026-07-02T00:00:00Z') }, d('2026-07-01T00:00:00Z'))).toBe(false);
  });
  it('does not start a non-PLANNED sprint', () => {
    expect(shouldAutoStart({ status: 'ACTIVE', startDate: d('2026-07-01T00:00:00Z') }, d('2026-07-05T00:00:00Z'))).toBe(false);
  });
  it('does not start when StartDate is null', () => {
    expect(shouldAutoStart({ status: 'PLANNED', startDate: null }, d('2026-07-05T00:00:00Z'))).toBe(false);
  });
});

describe('shouldAutoComplete', () => {
  it('completes an ACTIVE sprint once its EndDate has passed', () => {
    expect(shouldAutoComplete({ status: 'ACTIVE', endDate: d('2026-07-15T00:00:00Z') }, d('2026-07-15T01:00:00Z'))).toBe(true);
  });
  it('does not complete before EndDate', () => {
    expect(shouldAutoComplete({ status: 'ACTIVE', endDate: d('2026-07-16T00:00:00Z') }, d('2026-07-15T00:00:00Z'))).toBe(false);
  });
  it('does not complete a non-ACTIVE sprint', () => {
    expect(shouldAutoComplete({ status: 'PLANNED', endDate: d('2026-07-01T00:00:00Z') }, d('2026-07-05T00:00:00Z'))).toBe(false);
  });
});

describe('nextSprintWindow', () => {
  it('anchors the next window to the prior EndDate when StartDayOfWeek is null', () => {
    const w = nextSprintWindow({ priorEndDate: d('2026-07-15T00:00:00Z'), durationDays: 14, startDayOfWeek: null });
    expect(w.start.toISOString()).toBe('2026-07-15T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-07-29T00:00:00.000Z');
  });
  it('snaps the start to the next StartDayOfWeek (1=Mon) after the prior EndDate', () => {
    // Prior end Wed 2026-07-15 → next Monday is 2026-07-20.
    const w = nextSprintWindow({ priorEndDate: d('2026-07-15T00:00:00Z'), durationDays: 7, startDayOfWeek: 1 });
    expect(w.start.getUTCDay()).toBe(1);
    expect(w.start.toISOString()).toBe('2026-07-20T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-07-27T00:00:00.000Z');
  });
  it('seeds from `now` when there is no prior EndDate', () => {
    const w = nextSprintWindow({ priorEndDate: null, durationDays: 10, startDayOfWeek: null, now: d('2026-08-01T00:00:00Z') });
    expect(w.start.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-08-11T00:00:00.000Z');
  });
});

describe('selectRollForwardTasks', () => {
  it('keeps only unfinished tasks (not resolved, not DONE-status)', () => {
    const ids = selectRollForwardTasks([
      { id: 'a', status: 'In Progress', resolvedAt: null },
      { id: 'b', status: 'Done', resolvedAt: null },
      { id: 'c', status: 'To Do', resolvedAt: new Date('2026-07-01T00:00:00Z') },
      { id: 'd', status: 'To Do', resolvedAt: null },
    ]);
    expect(ids).toEqual(['a', 'd']);
  });
});
