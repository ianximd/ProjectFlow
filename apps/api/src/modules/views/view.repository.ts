import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import { getPool } from '../../shared/lib/db.js';
import { mapSavedViewRow } from './map.js';
import type { SavedView, ViewScopeType, ViewType, ViewTaskPage, ViewGroup } from '@projectflow/types';
import type { CompiledQuery } from './query/compiler.js';

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

  async getById(id: string): Promise<SavedView | null> {
    const rows = await execSpOne('usp_View_GetById', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0] ? mapSavedViewRow(rows[0]) : null;
  }

  async queryTasks(compiled: CompiledQuery, opts: { page: number; pageSize: number }): Promise<ViewTaskPage> {
    if (!Number.isInteger(opts.page) || opts.page < 1) throw new Error('page must be an integer >= 1');
    if (!Number.isInteger(opts.pageSize) || opts.pageSize < 1) throw new Error('pageSize must be an integer >= 1');
    const pool = await getPool();
    const offset = (opts.page - 1) * opts.pageSize;

    const joins = compiled.customSortJoins
      .map((j) => `LEFT JOIN TaskCustomFieldValues ${j.alias} ON ${j.alias}.TaskId = t.Id AND ${j.alias}.FieldId = @${j.alias}_fid`)
      .join('\n');

    const bindAll = (req: sql.Request) => {
      for (const [k, v] of Object.entries(compiled.params)) req.input(k, v as any);
      for (const j of compiled.customSortJoins) req.input(`${j.alias}_fid`, sql.UniqueIdentifier, j.fieldId);
      return req;
    };

    const pageSql =
      `SELECT t.* FROM Tasks t ${joins} WHERE ${compiled.whereSql} ` +
      `ORDER BY ${compiled.orderSql} OFFSET @__off ROWS FETCH NEXT @__size ROWS ONLY`;
    const pageReq = bindAll(pool.request());
    pageReq.input('__off', sql.Int, offset);
    pageReq.input('__size', sql.Int, opts.pageSize);
    const pageRes = await pageReq.query(pageSql);

    const countReq = bindAll(pool.request());
    const countRes = await countReq.query(`SELECT COUNT(*) AS Total FROM Tasks t WHERE ${compiled.whereSql}`);

    return { tasks: pageRes.recordset as any, total: countRes.recordset[0]?.Total ?? 0 };
  }

  /**
   * Returns one { key, label, count } entry per distinct value of `groupExpr`
   * within the compiled WHERE clause.  `groupExpr` MUST come from
   * `builtinGroupExpr()` — it is an allow-listed `t.<Column>` token, never
   * raw user input, so interpolating it is safe.
   * Note: custom-sort join params (_fid) are intentionally omitted because
   * the group query has no joins and those params would be unbound.
   */
  async groupCounts(compiled: CompiledQuery, groupExpr: string): Promise<ViewGroup[]> {
    const pool = await getPool();
    const req = pool.request();
    for (const [k, v] of Object.entries(compiled.params)) req.input(k, v as any);
    const res = await req.query(
      `SELECT ${groupExpr} AS GroupKey, COUNT(*) AS Cnt FROM Tasks t WHERE ${compiled.whereSql} GROUP BY ${groupExpr}`,
    );
    return res.recordset.map((r: any) => ({ key: String(r.GroupKey ?? ''), label: String(r.GroupKey ?? '∅'), count: r.Cnt }));
  }
}
