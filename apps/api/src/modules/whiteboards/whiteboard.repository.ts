import sql from 'mssql';
import { randomUUID } from 'node:crypto';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type {
  Whiteboard, WhiteboardSummary, WhiteboardTaskLink, WhiteboardScopeType,
} from '@projectflow/types';

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

/** Map a Whiteboards row (PascalCase, no DocYjs) → the Whiteboard contract. */
export function mapWhiteboardRow(r: any): Whiteboard {
  return {
    id:          r.Id,
    workspaceId: r.WorkspaceId,
    scopeType:   r.ScopeType as WhiteboardScopeType,
    scopeId:     r.ScopeId,
    name:        r.Name,
    docJson:     r.DocJson ?? null,
    createdById: r.CreatedById,
    createdAt:   iso(r.CreatedAt),
    updatedAt:   iso(r.UpdatedAt),
  };
}

function mapSummaryRow(r: any): WhiteboardSummary {
  return {
    id:          r.Id,
    workspaceId: r.WorkspaceId,
    scopeType:   r.ScopeType as WhiteboardScopeType,
    scopeId:     r.ScopeId,
    name:        r.Name,
    createdById: r.CreatedById,
    createdAt:   iso(r.CreatedAt),
    updatedAt:   iso(r.UpdatedAt),
  };
}

function mapLinkRow(r: any): WhiteboardTaskLink {
  return {
    id:           r.Id,
    whiteboardId: r.WhiteboardId,
    taskId:       r.TaskId,
    shapeId:      r.ShapeId,
    createdAt:    iso(r.CreatedAt),
    taskTitle:    r.TaskTitle ?? '',
    taskStatus:   r.TaskStatus ?? '',
    taskIssueKey: r.TaskIssueKey ?? '',
  };
}

export class WhiteboardRepository {
  async create(p: {
    workspaceId: string; scopeType: WhiteboardScopeType; scopeId: string; name: string; createdById: string;
  }): Promise<Whiteboard> {
    const rows = await execSpOne('usp_Whiteboard_Create', [
      { name: 'Id',          type: sql.UniqueIdentifier, value: randomUUID() },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: p.workspaceId },
      { name: 'ScopeType',   type: sql.NVarChar(12),     value: p.scopeType },
      { name: 'ScopeId',     type: sql.UniqueIdentifier, value: p.scopeId },
      { name: 'Name',        type: sql.NVarChar(255),    value: p.name },
      { name: 'CreatedById', type: sql.UniqueIdentifier, value: p.createdById },
    ]);
    return mapWhiteboardRow(rows[0]);
  }

  async getById(id: string): Promise<Whiteboard | null> {
    const rows = await execSpOne('usp_Whiteboard_GetById', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ? mapWhiteboardRow(rows[0]) : null;
  }

  async listForScope(
    workspaceId: string, scopeType: WhiteboardScopeType | null, scopeId: string | null,
  ): Promise<WhiteboardSummary[]> {
    const rows = await execSpOne('usp_Whiteboard_ListForScope', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'ScopeType',   type: sql.NVarChar(12),     value: scopeType },
      { name: 'ScopeId',     type: sql.UniqueIdentifier, value: scopeId },
    ]);
    return (rows as any[]).map(mapSummaryRow);
  }

  async update(id: string, name?: string): Promise<Whiteboard | null> {
    const rows = await execSpOne('usp_Whiteboard_Update', [
      { name: 'Id',   type: sql.UniqueIdentifier, value: id },
      { name: 'Name', type: sql.NVarChar(255),    value: name ?? null },
    ]);
    return rows[0] ? mapWhiteboardRow(rows[0]) : null;
  }

  async softDelete(id: string): Promise<Whiteboard | null> {
    const rows = await execSpOne('usp_Whiteboard_Delete', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ? mapWhiteboardRow(rows[0]) : null;
  }

  async getWorkspaceId(id: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_Whiteboard_GetWorkspaceId', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0]?.WorkspaceId ?? null;
  }

  /** Collab onLoadDocument: read the persisted Yjs binary (+ JSON) for whiteboard:<id>. */
  async getDoc(id: string): Promise<{ docYjs: Buffer | null; docJson: string | null } | null> {
    const rows = await execSpOne<{ DocYjs: Buffer | null; DocJson: string | null }>('usp_Whiteboard_GetDoc', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    const r = rows[0];
    return r ? { docYjs: r.DocYjs ?? null, docJson: r.DocJson ?? null } : null;
  }

  /** Collab onStoreDocument (debounced): persist Yjs binary + rendered JSON snapshot. */
  async saveDoc(id: string, docYjs: Buffer, docJson: string | null): Promise<void> {
    await execSpOne('usp_Whiteboard_SaveDoc', [
      { name: 'Id',      type: sql.UniqueIdentifier,  value: id },
      { name: 'DocYjs',  type: sql.VarBinary(sql.MAX), value: docYjs },
      { name: 'DocJson', type: sql.NVarChar(sql.MAX),  value: docJson },
    ]);
  }

  async createTaskLink(p: {
    whiteboardId: string; taskId: string; shapeId: string; createdById: string;
  }): Promise<WhiteboardTaskLink> {
    const rows = await execSpOne('usp_WhiteboardTaskLink_Create', [
      { name: 'WhiteboardId', type: sql.UniqueIdentifier, value: p.whiteboardId },
      { name: 'TaskId',       type: sql.UniqueIdentifier, value: p.taskId },
      { name: 'ShapeId',      type: sql.NVarChar(100),    value: p.shapeId },
      { name: 'CreatedById',  type: sql.UniqueIdentifier, value: p.createdById },
    ]);
    return mapLinkRow(rows[0]);
  }

  async listTaskLinks(whiteboardId: string): Promise<WhiteboardTaskLink[]> {
    const rows = await execSpOne('usp_WhiteboardTaskLink_ListForWhiteboard', [
      { name: 'WhiteboardId', type: sql.UniqueIdentifier, value: whiteboardId },
    ]);
    return (rows as any[]).map(mapLinkRow);
  }
}

export const whiteboardRepository = new WhiteboardRepository();
