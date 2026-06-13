import sql from 'mssql';
import { execSp, execSpOne } from '../../shared/lib/sqlClient.js';

export interface BurndownMeta {
  TotalPoints: number;
  StartDate:   Date;
  EndDate:     Date;
}

export interface BurndownPoint {
  Date:             Date;
  RemainingPoints:  number;
  IdealPoints:      number;
}

export interface VelocityRow {
  SprintId:        string;
  SprintName:      string;
  StartDate:       Date;
  EndDate:         Date;
  CommittedPoints: number;
  CompletedPoints: number;
}

export interface SprintSummaryMeta {
  SprintId:         string;
  SprintName:       string;
  StartDate:        Date;
  EndDate:          Date;
  TotalIssues:      number;
  CompletedIssues:  number;
  IncompleteIssues: number;
  TotalPoints:      number;
  CompletedPoints:  number;
}

export interface SprintStatusRow {
  Status:      string;
  IssueCount:  number;
  StoryPoints: number;
}

export interface WorkloadRow {
  AssigneeId:   string;
  AssigneeName: string;
  TotalIssues:  number;
  OpenIssues:   number;
  DoneIssues:   number;
  TotalPoints:  number;
  OpenPoints:   number;
}

export interface CreatedVsResolvedRow {
  WeekStart:  Date;
  WeekEnd:    Date;
  Created:    number;
  Resolved:   number;
}

export interface BurnupMeta {
  SprintId:         string;
  SprintName:       string;
  StartDate:        Date;
  EndDate:          Date;
  TotalScopePoints: number;
  CompletedPoints:  number;
}
export interface BurnupPointRow {
  Date:            Date;
  CompletedPoints: number;
  ScopePoints:     number;
}
export interface CumulativeFlowRowDb {
  Date:       Date;
  Status:     string;
  IssueCount: number;
}
export interface LeadCycleTimeRowDb {
  TaskId:           string;
  IssueKey:         string;
  Title:            string;
  CreatedAt:        Date;
  StartedAt:        Date | null;
  ResolvedAt:       Date | null;
  LeadTimeSeconds:  number | null;
  CycleTimeSeconds: number | null;
}
export interface PortfolioRowDb {
  ScopeType:       string;
  ScopeId:         string;
  ScopeName:       string;
  TotalIssues:     number;
  CompletedIssues: number;
  TotalPoints:     number;
  CompletedPoints: number;
}

export class ReportsRepository {
  async burndown(sprintId: string) {
    const sets = await execSp('usp_Report_Burndown', [
      { name: 'SprintId', type: sql.UniqueIdentifier, value: sprintId },
    ]);
    return {
      meta:   (sets[0]?.[0] ?? null) as BurndownMeta | null,
      points: (sets[1] ?? []) as BurndownPoint[],
    };
  }

  async velocity(projectId: string, numSprints = 5) {
    const rows = await execSpOne<VelocityRow>('usp_Report_Velocity', [
      { name: 'ProjectId',  type: sql.UniqueIdentifier, value: projectId },
      { name: 'NumSprints', type: sql.Int,              value: numSprints },
    ]);
    return rows as VelocityRow[];
  }

  async sprintSummary(sprintId: string) {
    const sets = await execSp('usp_Report_SprintSummary', [
      { name: 'SprintId', type: sql.UniqueIdentifier, value: sprintId },
    ]);
    return {
      summary:  (sets[0]?.[0] ?? null) as SprintSummaryMeta | null,
      statuses: (sets[1] ?? []) as SprintStatusRow[],
    };
  }

  async workload(projectId: string) {
    const rows = await execSpOne<WorkloadRow>('usp_Report_Workload', [
      { name: 'ProjectId', type: sql.UniqueIdentifier, value: projectId },
    ]);
    return rows as WorkloadRow[];
  }

  async createdVsResolved(projectId: string, weeks = 8) {
    const rows = await execSpOne<CreatedVsResolvedRow>('usp_Report_CreatedVsResolved', [
      { name: 'ProjectId', type: sql.UniqueIdentifier, value: projectId },
      { name: 'Weeks',     type: sql.Int,              value: weeks },
    ]);
    return rows as CreatedVsResolvedRow[];
  }

  async burnup(sprintId: string) {
    const sets = await execSp('usp_Report_Burnup', [
      { name: 'SprintId', type: sql.UniqueIdentifier, value: sprintId },
    ]);
    return {
      meta:   (sets[0]?.[0] ?? null) as BurnupMeta | null,
      points: (sets[1] ?? []) as BurnupPointRow[],
    };
  }

  async cumulativeFlow(scopeType: string, scopeId: string, weeks = 8) {
    const rows = await execSpOne<CumulativeFlowRowDb>('usp_Report_CumulativeFlow', [
      { name: 'ScopeType', type: sql.NVarChar(8),       value: scopeType },
      { name: 'ScopeId',   type: sql.UniqueIdentifier,  value: scopeId },
      { name: 'Weeks',     type: sql.Int,               value: weeks },
    ]);
    return rows as CumulativeFlowRowDb[];
  }

  async leadCycleTime(scopeType: string, scopeId: string, weeks = 12) {
    const rows = await execSpOne<LeadCycleTimeRowDb>('usp_Report_LeadCycleTime', [
      { name: 'ScopeType', type: sql.NVarChar(8),       value: scopeType },
      { name: 'ScopeId',   type: sql.UniqueIdentifier,  value: scopeId },
      { name: 'Weeks',     type: sql.Int,               value: weeks },
    ]);
    return rows as LeadCycleTimeRowDb[];
  }

  async portfolio(scopeType: string, scopeIds: string[]) {
    const rows = await execSpOne<PortfolioRowDb>('usp_Report_Portfolio', [
      { name: 'ScopeType', type: sql.NVarChar(8),       value: scopeType },
      { name: 'ScopeIds',  type: sql.NVarChar(sql.MAX), value: scopeIds.length ? scopeIds.join(',') : '' },
    ]);
    return rows as PortfolioRowDb[];
  }
}
