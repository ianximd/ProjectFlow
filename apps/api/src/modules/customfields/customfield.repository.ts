import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import { mapCustomFieldRow, mapEffectiveFieldRow } from './map.js';
import type { CustomField, CustomFieldScopeType, EffectiveField } from '@projectflow/types';

export class CustomFieldRepository {
  async getScopeNode(scopeType: CustomFieldScopeType, scopeId: string): Promise<{ workspaceId: string; scopePath: string } | null> {
    const rows = await execSpOne<{ WorkspaceId: string; ScopePath: string }>('usp_CustomField_GetScopeNode', [
      { name: 'ScopeType', type: sql.NVarChar(8), value: scopeType },
      { name: 'ScopeId',   type: sql.UniqueIdentifier, value: scopeId },
    ]);
    const r = rows[0];
    return r ? { workspaceId: r.WorkspaceId, scopePath: r.ScopePath } : null;
  }

  async getWorkspaceId(id: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_CustomField_GetWorkspaceId',
      [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0]?.WorkspaceId ?? null;
  }

  async create(p: {
    id: string; workspaceId: string; scopeType: CustomFieldScopeType; scopeId: string;
    scopePath: string; type: string; name: string; config: string | null; required: boolean; position: number;
  }): Promise<CustomField> {
    const rows = await execSpOne('usp_CustomField_Create', [
      { name: 'Id', type: sql.UniqueIdentifier, value: p.id },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: p.workspaceId },
      { name: 'ScopeType', type: sql.NVarChar(8), value: p.scopeType },
      { name: 'ScopeId', type: sql.UniqueIdentifier, value: p.scopeId },
      { name: 'ScopePath', type: sql.NVarChar(900), value: p.scopePath },
      { name: 'Type', type: sql.NVarChar(20), value: p.type },
      { name: 'Name', type: sql.NVarChar(255), value: p.name },
      { name: 'Config', type: sql.NVarChar(sql.MAX), value: p.config },
      { name: 'Required', type: sql.Bit, value: p.required ? 1 : 0 },
      { name: 'Position', type: sql.Float, value: p.position },
    ]);
    return mapCustomFieldRow(rows[0]);
  }

  async update(id: string, p: { name?: string; config?: string | null; clearConfig?: boolean; required?: boolean }): Promise<CustomField | null> {
    const rows = await execSpOne('usp_CustomField_Update', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
      { name: 'Name', type: sql.NVarChar(255), value: p.name ?? null },
      { name: 'Config', type: sql.NVarChar(sql.MAX), value: p.config ?? null },
      { name: 'ClearConfig', type: sql.Bit, value: p.clearConfig ? 1 : 0 },
      { name: 'Required', type: sql.Bit, value: p.required == null ? null : (p.required ? 1 : 0) },
    ]);
    return rows[0] ? mapCustomFieldRow(rows[0]) : null;
  }

  async delete(id: string): Promise<CustomField | null> {
    const rows = await execSpOne('usp_CustomField_Delete', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0] ? mapCustomFieldRow(rows[0]) : null;
  }

  async list(scopeType: CustomFieldScopeType, scopeId: string): Promise<CustomField[]> {
    const rows = await execSpOne('usp_CustomField_List', [
      { name: 'ScopeType', type: sql.NVarChar(8), value: scopeType },
      { name: 'ScopeId', type: sql.UniqueIdentifier, value: scopeId },
    ]);
    return (rows as any[]).map(mapCustomFieldRow);
  }

  async reorder(id: string, position: number): Promise<CustomField | null> {
    const rows = await execSpOne('usp_CustomField_Reorder', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
      { name: 'Position', type: sql.Float, value: position },
    ]);
    return rows[0] ? mapCustomFieldRow(rows[0]) : null;
  }

  async effectiveForTask(taskId: string): Promise<EffectiveField[]> {
    const rows = await execSpOne('usp_CustomField_EffectiveForTask',
      [{ name: 'TaskId', type: sql.UniqueIdentifier, value: taskId }]);
    return (rows as any[]).map(mapEffectiveFieldRow);
  }

  /**
   * Read ONE (task, field) stored value, JSON-decoded (null when absent).
   * Targeted read used by rollup source resolution so we DON'T re-compute the
   * task's full effective field set (which re-evaluates rollups → recursion).
   */
  async getValue(taskId: string, fieldId: string): Promise<unknown> {
    const rows = await execSpOne<{ Value: string | null }>('usp_TaskCustomFieldValue_GetOne', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
      { name: 'FieldId', type: sql.UniqueIdentifier, value: fieldId },
    ]);
    const raw = rows[0]?.Value;
    if (raw == null || raw === '') return null;
    try { return JSON.parse(String(raw)); } catch { return null; }
  }

  async getById(id: string): Promise<CustomField | null> {
    const rows = await execSpOne('usp_CustomField_GetById', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0] ? mapCustomFieldRow(rows[0]) : null;
  }

  async setValue(taskId: string, fieldId: string, valueJson: string | null): Promise<void> {
    await execSpOne('usp_TaskCustomFieldValue_Set', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
      { name: 'FieldId', type: sql.UniqueIdentifier, value: fieldId },
      { name: 'Value', type: sql.NVarChar(sql.MAX), value: valueJson },
    ]);
  }

  async deleteValue(taskId: string, fieldId: string): Promise<void> {
    await execSpOne('usp_TaskCustomFieldValue_Delete', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
      { name: 'FieldId', type: sql.UniqueIdentifier, value: fieldId },
    ]);
  }

  async requiredUnmetForStatus(taskId: string, targetStatus: string): Promise<CustomField[]> {
    const rows = await execSpOne('usp_CustomField_RequiredUnmetForStatus', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
      { name: 'TargetStatus', type: sql.NVarChar(100), value: targetStatus },
    ]);
    return (rows as any[]).map(mapCustomFieldRow);
  }

  async recomputeProgressAuto(parentTaskId: string): Promise<void> {
    await execSpOne('usp_TaskCustomField_RecomputeProgressAuto',
      [{ name: 'TaskId', type: sql.UniqueIdentifier, value: parentTaskId }]);
  }
}
