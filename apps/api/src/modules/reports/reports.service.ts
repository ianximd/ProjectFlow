import { ReportsRepository } from './reports.repository.js';
import { leadCycleSummary, portfolioRollup } from './analytics.js';
import type { BurnupReport, CumulativeFlowEntry, LeadCycleTimeReport, PortfolioEntry } from '@projectflow/types';

const repo = new ReportsRepository();

function toISO(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return new Date(d).toISOString().split('T')[0];
}

export class ReportsService {
  async burndown(sprintId: string) {
    const { meta, points } = await repo.burndown(sprintId);
    if (!meta) return null;
    return {
      totalPoints: meta.TotalPoints,
      startDate:   toISO(meta.StartDate),
      endDate:     toISO(meta.EndDate),
      points: points.map(p => ({
        date:            toISO(p.Date),
        remainingPoints: p.RemainingPoints,
        idealPoints:     p.IdealPoints,
      })),
    };
  }

  async velocity(projectId: string, numSprints = 5) {
    const rows = await repo.velocity(projectId, numSprints);
    // Reverse so chronological order
    return rows.reverse().map(r => ({
      sprintId:        r.SprintId,
      sprintName:      r.SprintName,
      startDate:       toISO(r.StartDate),
      endDate:         toISO(r.EndDate),
      committedPoints: r.CommittedPoints,
      completedPoints: r.CompletedPoints,
    }));
  }

  async sprintSummary(sprintId: string) {
    const { summary, statuses } = await repo.sprintSummary(sprintId);
    if (!summary) return null;
    return {
      sprintId:         summary.SprintId,
      sprintName:       summary.SprintName,
      startDate:        toISO(summary.StartDate),
      endDate:          toISO(summary.EndDate),
      totalIssues:      summary.TotalIssues,
      completedIssues:  summary.CompletedIssues,
      incompleteIssues: summary.IncompleteIssues,
      totalPoints:      summary.TotalPoints,
      completedPoints:  summary.CompletedPoints,
      statusBreakdown:  statuses.map(s => ({
        status:      s.Status,
        issueCount:  s.IssueCount,
        storyPoints: s.StoryPoints,
      })),
    };
  }

  async workload(projectId: string) {
    const rows = await repo.workload(projectId);
    return rows.map(r => ({
      assigneeId:   r.AssigneeId,
      assigneeName: r.AssigneeName,
      totalIssues:  r.TotalIssues,
      openIssues:   r.OpenIssues,
      doneIssues:   r.DoneIssues,
      totalPoints:  r.TotalPoints,
      openPoints:   r.OpenPoints,
    }));
  }

  async createdVsResolved(projectId: string, weeks = 8) {
    const rows = await repo.createdVsResolved(projectId, weeks);
    return rows.map(r => ({
      weekStart: toISO(r.WeekStart),
      weekEnd:   toISO(r.WeekEnd),
      created:   r.Created,
      resolved:  r.Resolved,
    }));
  }

  async burnup(sprintId: string): Promise<BurnupReport | null> {
    const { meta, points } = await repo.burnup(sprintId);
    if (!meta) return null;
    return {
      sprintId:         meta.SprintId,
      sprintName:       meta.SprintName,
      startDate:        toISO(meta.StartDate),
      endDate:          toISO(meta.EndDate),
      totalScopePoints: meta.TotalScopePoints,
      completedPoints:  meta.CompletedPoints,
      points: points.map(p => ({
        date:            toISO(p.Date),
        completedPoints: p.CompletedPoints,
        scopePoints:     p.ScopePoints,
      })),
    };
  }

  async cumulativeFlow(scopeType: string, scopeId: string, weeks = 8): Promise<CumulativeFlowEntry[]> {
    const rows = await repo.cumulativeFlow(scopeType, scopeId, weeks);
    return rows.map(r => ({
      date:       toISO(r.Date),
      status:     r.Status,
      issueCount: r.IssueCount,
    }));
  }

  async leadCycleTime(scopeType: string, scopeId: string, weeks = 12): Promise<LeadCycleTimeReport> {
    const rows = await repo.leadCycleTime(scopeType, scopeId, weeks);
    const tasks = rows.map(r => ({
      taskId:           r.TaskId,
      issueKey:         r.IssueKey,
      title:            r.Title,
      createdAt:        toISO(r.CreatedAt),
      startedAt:        toISO(r.StartedAt),
      resolvedAt:       toISO(r.ResolvedAt),
      leadTimeSeconds:  r.LeadTimeSeconds,
      cycleTimeSeconds: r.CycleTimeSeconds,
    }));
    const summary = leadCycleSummary(tasks);
    return {
      scopeType,
      scopeId,
      rangeStart: tasks.length ? tasks[tasks.length - 1].createdAt : null,
      rangeEnd:   tasks.length ? tasks[0].createdAt : null,
      avgLeadTimeSeconds:  summary.avgLeadTimeSeconds,
      avgCycleTimeSeconds: summary.avgCycleTimeSeconds,
      tasks,
    };
  }

  async portfolio(scopeType: string, scopeIds: string[]): Promise<PortfolioEntry[]> {
    const rows = await repo.portfolio(scopeType, scopeIds);
    return portfolioRollup(rows.map(r => ({
      scopeType:       r.ScopeType,
      scopeId:         r.ScopeId,
      scopeName:       r.ScopeName,
      totalIssues:     r.TotalIssues,
      completedIssues: r.CompletedIssues,
      totalPoints:     r.TotalPoints,
      completedPoints: r.CompletedPoints,
    })));
  }
}
