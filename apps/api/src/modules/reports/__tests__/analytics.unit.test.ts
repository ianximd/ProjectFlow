import { describe, it, expect } from 'vitest';
import {
  cumulativeFlowSeries,
  leadCycleSummary,
  portfolioRollup,
  burnupCompletionPct,
  type CumulativeFlowRow,
  type LeadCycleRow,
  type PortfolioRow,
} from '../analytics.js';

describe('burnupCompletionPct', () => {
  it('is completed / scope as a percentage', () => {
    expect(burnupCompletionPct(30, 120)).toBe(25);
  });
  it('is 0 when scope is 0 (no divide-by-zero)', () => {
    expect(burnupCompletionPct(0, 0)).toBe(0);
  });
});

describe('cumulativeFlowSeries', () => {
  it('pivots long (date,status,count) rows into per-date band maps preserving status order', () => {
    const rows: CumulativeFlowRow[] = [
      { date: '2026-06-01', status: 'TODO', issueCount: 5 },
      { date: '2026-06-01', status: 'DONE', issueCount: 2 },
      { date: '2026-06-02', status: 'TODO', issueCount: 3 },
      { date: '2026-06-02', status: 'DONE', issueCount: 4 },
    ];
    const series = cumulativeFlowSeries(rows);
    expect(series.statuses).toEqual(['TODO', 'DONE']);
    expect(series.points).toEqual([
      { date: '2026-06-01', TODO: 5, DONE: 2 },
      { date: '2026-06-02', TODO: 3, DONE: 4 },
    ]);
  });
  it('fills a missing band on a date with 0', () => {
    const rows: CumulativeFlowRow[] = [
      { date: '2026-06-01', status: 'TODO', issueCount: 5 },
      { date: '2026-06-02', status: 'DONE', issueCount: 4 },
    ];
    const series = cumulativeFlowSeries(rows);
    expect(series.statuses).toEqual(['TODO', 'DONE']);
    expect(series.points).toEqual([
      { date: '2026-06-01', TODO: 5, DONE: 0 },
      { date: '2026-06-02', TODO: 0, DONE: 4 },
    ]);
  });
});

describe('leadCycleSummary', () => {
  it('averages only the non-null lead/cycle times', () => {
    const rows: LeadCycleRow[] = [
      { taskId: 't1', leadTimeSeconds: 100, cycleTimeSeconds: 40 },
      { taskId: 't2', leadTimeSeconds: 300, cycleTimeSeconds: null },
      { taskId: 't3', leadTimeSeconds: null, cycleTimeSeconds: null },
    ];
    const s = leadCycleSummary(rows);
    expect(s.avgLeadTimeSeconds).toBe(200);   // (100 + 300) / 2
    expect(s.avgCycleTimeSeconds).toBe(40);    // only t1 has cycle time
  });
  it('returns null averages when no task has a measured time', () => {
    const s = leadCycleSummary([{ taskId: 't1', leadTimeSeconds: null, cycleTimeSeconds: null }]);
    expect(s.avgLeadTimeSeconds).toBeNull();
    expect(s.avgCycleTimeSeconds).toBeNull();
  });
});

describe('portfolioRollup', () => {
  it('derives progressPct + onTrack per scope across multiple scopes', () => {
    const rows: PortfolioRow[] = [
      { scopeType: 'folder', scopeId: 'f1', scopeName: 'Alpha', totalIssues: 10, completedIssues: 7, totalPoints: 20, completedPoints: 14 },
      { scopeType: 'folder', scopeId: 'f2', scopeName: 'Beta',  totalIssues: 10, completedIssues: 2, totalPoints: 20, completedPoints: 4 },
      { scopeType: 'folder', scopeId: 'f3', scopeName: 'Gamma', totalIssues: 0,  completedIssues: 0, totalPoints: 0,  completedPoints: 0 },
    ];
    const out = portfolioRollup(rows);
    expect(out[0]).toMatchObject({ scopeId: 'f1', progressPct: 70, onTrack: true });
    expect(out[1]).toMatchObject({ scopeId: 'f2', progressPct: 20, onTrack: false });
    expect(out[2]).toMatchObject({ scopeId: 'f3', progressPct: 0, onTrack: true });
  });
});
