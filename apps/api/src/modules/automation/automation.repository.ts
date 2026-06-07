import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type {
  AutomationTriggerConfig,
  AutomationCondition,
  AutomationAction,
  AutomationScopeType,
  AutomationRun,
} from '@projectflow/types';

export interface AutomationRuleRow {
  Id:              string;
  ProjectId:       string | null;
  WorkspaceId:     string;
  ScopeType:       AutomationScopeType;
  ScopeId:         string;
  Name:            string;
  IsEnabled:       boolean;
  TriggerConfig:   string;
  ConditionConfig: string;
  ActionConfig:    string;
  ExecutionCount:  number;
  LastExecutedAt:  Date | null;
  CreatedAt:       Date;
  UpdatedAt:       Date;
}

function parseRow(row: AutomationRuleRow) {
  return {
    id:             row.Id,
    scopeType:      row.ScopeType,
    workspaceId:    row.WorkspaceId,
    projectId:      row.ProjectId,
    name:           row.Name,
    isEnabled:      Boolean(row.IsEnabled),
    trigger:        JSON.parse(row.TriggerConfig)   as AutomationTriggerConfig,
    conditions:     JSON.parse(row.ConditionConfig) as AutomationCondition[],
    actions:        JSON.parse(row.ActionConfig)    as AutomationAction[],
    executionCount: row.ExecutionCount,
    lastExecutedAt: row.LastExecutedAt?.toISOString() ?? null,
    createdAt:      row.CreatedAt.toISOString(),
    updatedAt:      row.UpdatedAt.toISOString(),
  };
}

interface AutomationRunRow {
  Id: string; RuleId: string; WorkspaceId: string; ProjectId: string | null;
  TriggerType: string; Status: AutomationRun['status'];
  Payload: string | null; ActionResults: string | null; Error: string | null;
  Depth: number; StartedAt: Date; FinishedAt: Date | null; DurationMs: number | null;
}

function parseRunRow(row: AutomationRunRow): AutomationRun {
  return {
    id: row.Id, ruleId: row.RuleId, workspaceId: row.WorkspaceId, projectId: row.ProjectId,
    triggerType: row.TriggerType, status: row.Status,
    payload:       row.Payload       ? JSON.parse(row.Payload)       : null,
    actionResults: row.ActionResults ? JSON.parse(row.ActionResults) : null,
    error: row.Error, depth: row.Depth,
    startedAt: row.StartedAt.toISOString(),
    finishedAt: row.FinishedAt?.toISOString() ?? null,
    durationMs: row.DurationMs,
  };
}

export class AutomationRepository {
  /**
   * Single-row read. Backs the audit-snapshot fetcher (W43 Option A) so
   * automation-rule updates surface field-level diffs in AuditLog —
   * including the JSON config blobs so an audit row records "the trigger
   * changed from issue.created to issue.transitioned" rather than just
   * "the rule was updated."
   */
  async getById(id: string): Promise<Record<string, unknown> | null> {
    const rows = await execSpOne<Record<string, unknown>>('usp_AutomationRule_GetById', [
      { name: 'RuleId', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ?? null;
  }

  async create(
    scopeType: AutomationScopeType,
    workspaceId: string,
    projectId: string | null,
    name: string,
    trigger: AutomationTriggerConfig,
    conditions: AutomationCondition[],
    actions: AutomationAction[],
  ) {
    const rows = await execSpOne<AutomationRuleRow>('usp_AutomationRule_Create', [
      { name: 'ScopeType',       type: sql.NVarChar(12),      value: scopeType },
      { name: 'WorkspaceId',     type: sql.UniqueIdentifier,  value: workspaceId },
      { name: 'ProjectId',       type: sql.UniqueIdentifier,  value: projectId },
      { name: 'Name',            type: sql.NVarChar(255),     value: name },
      { name: 'TriggerConfig',   type: sql.NVarChar(sql.MAX), value: JSON.stringify(trigger) },
      { name: 'ConditionConfig', type: sql.NVarChar(sql.MAX), value: JSON.stringify(conditions) },
      { name: 'ActionConfig',    type: sql.NVarChar(sql.MAX), value: JSON.stringify(actions) },
    ]);
    return parseRow(rows[0]);
  }

  async list(projectId: string) {
    const rows = await execSpOne<AutomationRuleRow>('usp_AutomationRule_List', [
      { name: 'ProjectId', type: sql.UniqueIdentifier, value: projectId },
    ]);
    return rows.map(parseRow);
  }

  async update(
    id: string,
    patch: {
      name?:       string;
      isEnabled?:  boolean;
      trigger?:    AutomationTriggerConfig;
      conditions?: AutomationCondition[];
      actions?:    AutomationAction[];
    },
  ) {
    const rows = await execSpOne<AutomationRuleRow>('usp_AutomationRule_Update', [
      { name: 'Id',              type: sql.UniqueIdentifier,  value: id },
      { name: 'Name',            type: sql.NVarChar(255),     value: patch.name       ?? null },
      { name: 'IsEnabled',       type: sql.Bit,               value: patch.isEnabled  ?? null },
      { name: 'TriggerConfig',   type: sql.NVarChar(sql.MAX), value: patch.trigger    ? JSON.stringify(patch.trigger)    : null },
      { name: 'ConditionConfig', type: sql.NVarChar(sql.MAX), value: patch.conditions ? JSON.stringify(patch.conditions) : null },
      { name: 'ActionConfig',    type: sql.NVarChar(sql.MAX), value: patch.actions    ? JSON.stringify(patch.actions)    : null },
    ]);
    return rows[0] ? parseRow(rows[0]) : null;
  }

  async delete(id: string): Promise<void> {
    await execSpOne('usp_AutomationRule_Delete', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
  }

  async getByTrigger(projectId: string | null, workspaceId: string, triggerType: string) {
    const rows = await execSpOne<AutomationRuleRow>('usp_AutomationRule_GetByTrigger', [
      { name: 'ProjectId',   type: sql.UniqueIdentifier, value: projectId },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'TriggerType', type: sql.NVarChar(50),     value: triggerType },
    ]);
    return rows.map(parseRow);
  }

  async recordExecution(id: string): Promise<void> {
    await execSpOne('usp_AutomationRule_RecordExecution', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
  }

  async getWorkspaceId(ruleId: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_Automation_GetWorkspaceId', [
      { name: 'RuleId', type: sql.UniqueIdentifier, value: ruleId },
    ]);
    return rows[0]?.WorkspaceId ?? null;
  }

  async recordRun(run: {
    ruleId: string; workspaceId: string; projectId: string | null; triggerType: string;
    status: AutomationRun['status']; payload?: string | null; actionResults?: string | null;
    error?: string | null; depth: number; startedAt: Date; durationMs?: number | null;
  }): Promise<AutomationRun> {
    const rows = await execSpOne<AutomationRunRow>('usp_AutomationRun_Record', [
      { name: 'RuleId',        type: sql.UniqueIdentifier,  value: run.ruleId },
      { name: 'WorkspaceId',   type: sql.UniqueIdentifier,  value: run.workspaceId },
      { name: 'ProjectId',     type: sql.UniqueIdentifier,  value: run.projectId },
      { name: 'TriggerType',   type: sql.NVarChar(40),      value: run.triggerType },
      { name: 'Status',        type: sql.NVarChar(16),      value: run.status },
      { name: 'Payload',       type: sql.NVarChar(sql.MAX), value: run.payload ?? null },
      { name: 'ActionResults', type: sql.NVarChar(sql.MAX), value: run.actionResults ?? null },
      { name: 'Error',         type: sql.NVarChar(sql.MAX), value: run.error ?? null },
      { name: 'Depth',         type: sql.Int,               value: run.depth },
      { name: 'StartedAt',     type: sql.DateTime2,         value: run.startedAt },
      { name: 'DurationMs',    type: sql.Int,               value: run.durationMs ?? null },
    ]);
    return parseRunRow(rows[0]);
  }

  async listRunsByRule(ruleId: string, limit = 50, offset = 0): Promise<AutomationRun[]> {
    const rows = await execSpOne<AutomationRunRow>('usp_AutomationRun_ListByRule', [
      { name: 'RuleId', type: sql.UniqueIdentifier, value: ruleId },
      { name: 'Limit',  type: sql.Int,              value: limit },
      { name: 'Offset', type: sql.Int,              value: offset },
    ]);
    return rows.map(parseRunRow);
  }
}
