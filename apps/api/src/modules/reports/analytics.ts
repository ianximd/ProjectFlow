import type { PortfolioEntry } from '@projectflow/types';

// ── Burnup ─────────────────────────────────────────────────────────────────
/** Completed / scope as a 0–100 percentage; 0 when scope is 0. */
export function burnupCompletionPct(completedPoints: number, scopePoints: number): number {
  if (scopePoints <= 0) return 0;
  return Math.round((completedPoints / scopePoints) * 100);
}

// ── Cumulative flow ──────────────────────────────────────────────────────────
export interface CumulativeFlowRow {
  date: string;
  status: string;
  issueCount: number;
}

export interface CumulativeFlowSeries {
  statuses: string[];                              // bands in first-seen order
  points: Array<Record<string, number | string>>; // { date, [status]: count } per day, every band filled
}

/** Pivot long (date,status,count) report rows into a per-date wide series with
 *  every status band present (missing → 0), preserving first-seen status order. */
export function cumulativeFlowSeries(rows: CumulativeFlowRow[]): CumulativeFlowSeries {
  const statuses: string[] = [];
  const byDate = new Map<string, Record<string, number | string>>();
  for (const r of rows) {
    if (!statuses.includes(r.status)) statuses.push(r.status);
    let point = byDate.get(r.date);
    if (!point) { point = { date: r.date }; byDate.set(r.date, point); }
    point[r.status] = r.issueCount;
  }
  const points = [...byDate.values()].map((p) => {
    for (const s of statuses) if (p[s] === undefined) p[s] = 0;
    return p;
  });
  return { statuses, points };
}

// ── Lead / cycle time ────────────────────────────────────────────────────────
export interface LeadCycleRow {
  taskId: string;
  leadTimeSeconds: number | null;
  cycleTimeSeconds: number | null;
}

export interface LeadCycleSummary {
  avgLeadTimeSeconds: number | null;
  avgCycleTimeSeconds: number | null;
}

function avg(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return Math.round(present.reduce((a, b) => a + b, 0) / present.length);
}

/** Average lead/cycle time across tasks, ignoring nulls (unresolved/never-started). */
export function leadCycleSummary(rows: LeadCycleRow[]): LeadCycleSummary {
  return {
    avgLeadTimeSeconds:  avg(rows.map((r) => r.leadTimeSeconds)),
    avgCycleTimeSeconds: avg(rows.map((r) => r.cycleTimeSeconds)),
  };
}

// ── Portfolio ────────────────────────────────────────────────────────────────
export interface PortfolioRow {
  scopeType: string;
  scopeId: string;
  scopeName: string;
  totalIssues: number;
  completedIssues: number;
  totalPoints: number;
  completedPoints: number;
}

/** Derive progressPct + onTrack per scope. v1 on-track heuristic: a scope is on
 *  track if it has completed ≥ half its issues, or has nothing to do. */
export function portfolioRollup(rows: PortfolioRow[]): PortfolioEntry[] {
  return rows.map((r) => {
    const progressPct = r.totalIssues > 0
      ? Math.round((r.completedIssues / r.totalIssues) * 100)
      : 0;
    const onTrack = r.totalIssues === 0 ? true : progressPct >= 50;
    return {
      scopeType: r.scopeType,
      scopeId: r.scopeId,
      scopeName: r.scopeName,
      totalIssues: r.totalIssues,
      completedIssues: r.completedIssues,
      totalPoints: r.totalPoints,
      completedPoints: r.completedPoints,
      progressPct,
      onTrack,
    };
  });
}
