import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import { mapTemplateRow } from './template.map.js';
import type { Template, TemplateScopeType } from '@projectflow/types';

export class TemplateRepository {
  async create(p: {
    id: string; workspaceId: string; scopeType: TemplateScopeType;
    name: string; description: string | null; snapshot: string; createdById: string;
  }): Promise<Template> {
    const rows = await execSpOne('usp_Template_Create', [
      { name: 'Id',          type: sql.UniqueIdentifier,  value: p.id },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier,  value: p.workspaceId },
      { name: 'ScopeType',   type: sql.NVarChar(8),       value: p.scopeType },
      { name: 'Name',        type: sql.NVarChar(255),     value: p.name },
      { name: 'Description', type: sql.NVarChar(sql.MAX), value: p.description },
      { name: 'Snapshot',    type: sql.NVarChar(sql.MAX), value: p.snapshot },
      { name: 'CreatedById', type: sql.UniqueIdentifier,  value: p.createdById },
    ]);
    return mapTemplateRow(rows[0]);
  }

  async list(workspaceId: string, scopeType: TemplateScopeType | null): Promise<Template[]> {
    const rows = await execSpOne('usp_Template_List', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'ScopeType',   type: sql.NVarChar(8),      value: scopeType ?? null },
    ]);
    return (rows as any[]).map(mapTemplateRow);
  }

  /** Metadata-only read (the row WITHOUT exposing Snapshot to the caller). */
  async getById(id: string): Promise<Template | null> {
    const rows = await execSpOne('usp_Template_GetById', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0] ? mapTemplateRow(rows[0]) : null;
  }

  /** Read the raw row incl. Snapshot JSON (used by apply, a later batch). */
  async getRowById(id: string): Promise<any | null> {
    const rows = await execSpOne('usp_Template_GetById', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0] ?? null;
  }

  /** Soft-delete; returns the affected row mapped, or null when it was already gone. */
  async delete(id: string): Promise<Template | null> {
    const rows = await execSpOne('usp_Template_Delete', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    // The SP returns a (Snapshot-less) row ONLY when THIS call deleted it; an
    // already-deleted/absent id yields no rows → null (a repeat delete is a 404).
    const r = rows[0];
    if (!r) return null;
    return mapTemplateRow(r);
  }
}

export const templateRepository = new TemplateRepository();
