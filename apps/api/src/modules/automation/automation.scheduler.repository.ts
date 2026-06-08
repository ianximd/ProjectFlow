import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';

export interface DueDateRuleRow {
  RuleId:           string;
  ScopeType:        string;
  WorkspaceId:      string;
  ProjectId:        string | null;
  TriggerConfig:    string;
  TaskId:           string;
  TaskProjectId:    string | null;
  TaskWorkspaceId:  string;
  TriggerType:      string;
}

export interface ScheduledRuleRow {
  RuleId:        string;
  ScopeType:     string;
  WorkspaceId:   string;
  ProjectId:     string | null;
  TriggerConfig: string;
  TriggerType:   string;
}

export class AutomationSchedulerRepository {
  async listDueDateRules(since: Date, now: Date): Promise<DueDateRuleRow[]> {
    const rows = await execSpOne<DueDateRuleRow>('usp_AutomationRule_ListDueDateRules', [
      { name: 'Since', type: sql.DateTime2, value: since },
      { name: 'Now',   type: sql.DateTime2, value: now },
    ]);
    return Array.from(rows);
  }

  async listScheduledRules(): Promise<ScheduledRuleRow[]> {
    const rows = await execSpOne<ScheduledRuleRow>('usp_AutomationRule_ListScheduledRules', []);
    return Array.from(rows);
  }
}

export const automationSchedulerRepository = new AutomationSchedulerRepository();
