import { ReportsRepository } from './reports.repository.js';

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
}
