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
}
