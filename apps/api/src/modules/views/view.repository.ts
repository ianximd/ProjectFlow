import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import { mapSavedViewRow } from './map.js';
import type { SavedView, ViewScopeType, ViewType } from '@projectflow/types';

export class ViewRepository {
  async getWorkspaceId(id: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_View_GetWorkspaceId',
      [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0]?.WorkspaceId ?? null;
  }

  async create(p: {
    id: string; workspaceId: string; ownerId: string;
    scopeType: ViewScopeType; scopeId: string | null; scopePath: string | null;
    type: ViewType; name: string; isShared: boolean; isDefault: boolean;
    config: string; position: number;
  }): Promise<SavedView> {
    const rows = await execSpOne('usp_View_Create', [
      { name: 'Id',          type: sql.UniqueIdentifier,   value: p.id },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier,   value: p.workspaceId },
      { name: 'OwnerId',     type: sql.UniqueIdentifier,   value: p.ownerId },
      { name: 'ScopeType',   type: sql.NVarChar(12),       value: p.scopeType },
      { name: 'ScopeId',     type: sql.UniqueIdentifier,   value: p.scopeId },
      { name: 'ScopePath',   type: sql.NVarChar(900),      value: p.scopePath },
      { name: 'Type',        type: sql.NVarChar(10),       value: p.type },
      { name: 'Name',        type: sql.NVarChar(255),      value: p.name },
      { name: 'IsShared',    type: sql.Bit,                value: p.isShared ? 1 : 0 },
      { name: 'IsDefault',   type: sql.Bit,                value: p.isDefault ? 1 : 0 },
      { name: 'Config',      type: sql.NVarChar(sql.MAX),  value: p.config },
      { name: 'Position',    type: sql.Float,              value: p.position },
    ]);
    return mapSavedViewRow(rows[0]);
  }

  async update(
    id: string,
    p: { name?: string; isShared?: boolean; isDefault?: boolean; config?: string },
  ): Promise<SavedView | null> {
    const rows = await execSpOne('usp_View_Update', [
      { name: 'Id',        type: sql.UniqueIdentifier,  value: id },
      { name: 'Name',      type: sql.NVarChar(255),     value: p.name ?? null },
      { name: 'IsShared',  type: sql.Bit,               value: p.isShared == null ? null : (p.isShared ? 1 : 0) },
      { name: 'IsDefault', type: sql.Bit,               value: p.isDefault == null ? null : (p.isDefault ? 1 : 0) },
      { name: 'Config',    type: sql.NVarChar(sql.MAX), value: p.config ?? null },
    ]);
    return rows[0] ? mapSavedViewRow(rows[0]) : null;
  }

  async delete(id: string): Promise<SavedView | null> {
    const rows = await execSpOne('usp_View_Delete',
      [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0] ? mapSavedViewRow(rows[0]) : null;
  }

  async reorder(id: string, position: number): Promise<SavedView | null> {
    const rows = await execSpOne('usp_View_Reorder', [
      { name: 'Id',       type: sql.UniqueIdentifier, value: id },
      { name: 'Position', type: sql.Float,            value: position },
    ]);
    return rows[0] ? mapSavedViewRow(rows[0]) : null;
  }

  async list(
    workspaceId: string,
    userId: string,
    scopeType: ViewScopeType,
    scopeId: string | null,
  ): Promise<SavedView[]> {
    const rows = await execSpOne('usp_View_List', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'UserId',      type: sql.UniqueIdentifier, value: userId },
      { name: 'ScopeType',   type: sql.NVarChar(12),     value: scopeType },
      { name: 'ScopeId',     type: sql.UniqueIdentifier, value: scopeId },
    ]);
    return (rows as any[]).map(mapSavedViewRow);
  }
}
