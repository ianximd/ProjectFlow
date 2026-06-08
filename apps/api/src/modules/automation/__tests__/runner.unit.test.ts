import { describe, it, expect } from 'vitest';
import { nextDelayedSlice, cronWindowElapsed } from '../automation.runner.js';
import type { AutomationAction } from '@projectflow/types';

const a = (type: AutomationAction['type'], delaySeconds?: number): AutomationAction =>
  ({ type, delaySeconds } as AutomationAction);

describe('nextDelayedSlice', () => {
  it('returns null delay when no remaining action is delayed', () => {
    const r = nextDelayedSlice([a('CHANGE_STATUS'), a('ASSIGN'), a('POST_COMMENT')], 0);
    expect(r.runNow).toEqual([0, 1, 2]);
    expect(r.resumeAt).toBeNull();
    expect(r.delayMs).toBe(0);
  });

  it('runs the actions BEFORE the first delayed action, then defers from it', () => {
    const r = nextDelayedSlice([a('CHANGE_STATUS'), a('ASSIGN', 60), a('POST_COMMENT')], 0);
    expect(r.runNow).toEqual([0]);
    expect(r.resumeAt).toBe(1);
    expect(r.delayMs).toBe(60000);
  });

  it('treats a delay on the FIRST remaining action as an immediate defer (runs nothing now)', () => {
    const r = nextDelayedSlice([a('CHANGE_STATUS', 30), a('ASSIGN')], 0);
    expect(r.runNow).toEqual([]);
    expect(r.resumeAt).toBe(0);
    expect(r.delayMs).toBe(30000);
  });

  it('resumes mid-list from actionIndex and ignores already-run prefix', () => {
    const r = nextDelayedSlice(
      [a('CHANGE_STATUS'), a('ASSIGN'), a('POST_COMMENT', 120), a('SET_PRIORITY')],
      2,
    );
    expect(r.runNow).toEqual([2, 3]);
    expect(r.resumeAt).toBeNull();
  });

  it('treats a non-positive or missing delaySeconds as no delay', () => {
    const r = nextDelayedSlice([a('CHANGE_STATUS', 0), a('ASSIGN', -5), a('POST_COMMENT')], 0);
    expect(r.runNow).toEqual([0, 1, 2]);
    expect(r.resumeAt).toBeNull();
  });

  it('runs a resume-at-0 leading-delay action when prepaidStart is true (no infinite loop)', () => {
    const r = nextDelayedSlice([a('CHANGE_STATUS', 30), a('ASSIGN')], 0, true);
    expect(r.runNow).toEqual([0, 1]);
    expect(r.resumeAt).toBeNull();
  });

  it('still defers a leading-delay action on the fresh first pass (prepaidStart false)', () => {
    const r = nextDelayedSlice([a('CHANGE_STATUS', 30), a('ASSIGN')], 0, false);
    expect(r.runNow).toEqual([]);
    expect(r.resumeAt).toBe(0);
    expect(r.delayMs).toBe(30000);
  });
});

describe('cronWindowElapsed', () => {
  it('fires when a cron tick falls within (since, now]', () => {
    expect(
      cronWindowElapsed(
        '* * * * *',
        new Date('2026-06-07T09:00:30.000Z'),
        new Date('2026-06-07T09:01:30.000Z'),
      ),
    ).toBe(true);
  });

  it('does not fire when no cron tick falls in the window', () => {
    expect(
      cronWindowElapsed(
        '0 * * * *',
        new Date('2026-06-07T09:00:10.000Z'),
        new Date('2026-06-07T09:00:40.000Z'),
      ),
    ).toBe(false);
  });

  it('returns false for an invalid cron expression rather than throwing', () => {
    expect(
      cronWindowElapsed(
        'not-a-cron',
        new Date('2026-06-07T09:00:00.000Z'),
        new Date('2026-06-07T09:05:00.000Z'),
      ),
    ).toBe(false);
  });
});
