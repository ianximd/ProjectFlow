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

  /**
   * Phase 5d: SHARED views for a scope, WITHOUT the per-user visibility filter
   * usp_View_List applies. Template capture is actor-agnostic — it portably
   * copies a list's shared views (private views belong to one user, not copied).
   */
  async listForScope(scopeType: ViewScopeType, scopeId: string | null): Promise<SavedView[]> {
    const rows = await execSpOne('usp_View_ListForScope', [
      { name: 'ScopeType', type: sql.NVarChar(12),     value: scopeType },
      { name: 'ScopeId',   type: sql.UniqueIdentifier, value: scopeId },
    ]);
    return (rows as any[]).map(mapSavedViewRow);
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

    const rows = pageRes.recordset as any[];
    await this.attachCustomFieldValues(pool, rows);
    await this.attachAssignees(pool, rows);

    const countReq = bindAll(pool.request());
    const countRes = await countReq.query(`SELECT COUNT(*) AS Total FROM Tasks t WHERE ${compiled.whereSql}`);

    return { tasks: rows as any, total: countRes.recordset[0]?.Total ?? 0 };
  }

  /**
   * Widen the page rows with their custom-field values so the table/list views
   * can render custom columns (filter/sort/group already resolve them in SQL,
   * but `SELECT t.*` never carried the values). One batched lookup keyed on the
   * page's task ids — bounded by pageSize — keeps this O(1) round-trips.
   *
   * Each row gets `CustomFieldValues: { [fieldId]: rawValue }` where `rawValue`
   * is the value EXACTLY as stored (a JSON string, e.g. '8' or '["a","b"]') and
   * the key is the FieldId LOWERCASED. mssql returns UNIQUEIDENTIFIER uppercase,
   * but a custom-field id can reach the client in either case; lowercasing both
   * here and at the client lookup makes the column resolve deterministic.
   */
  private async attachCustomFieldValues(pool: sql.ConnectionPool, rows: any[]): Promise<void> {
    for (const r of rows) r.CustomFieldValues = {};
    if (rows.length === 0) return;

    const req = pool.request();
    const idParams = rows.map((r, i) => {
      const k = `cfid${i}`;
      req.input(k, sql.UniqueIdentifier, r.Id);
      return `@${k}`;
    });
    const res = await req.query(
      `SELECT TaskId, FieldId, Value FROM TaskCustomFieldValues WHERE TaskId IN (${idParams.join(', ')})`,
    );

    const byTask = new Map<string, Record<string, string>>();
    for (const v of res.recordset as any[]) {
      const tid = String(v.TaskId).toLowerCase();
      const m = byTask.get(tid) ?? {};
      m[String(v.FieldId).toLowerCase()] = v.Value;
      byTask.set(tid, m);
    }
    for (const r of rows) {
      r.CustomFieldValues = byTask.get(String(r.Id).toLowerCase()) ?? {};
    }
  }

  /**
   * Widen the page rows with their assignees so the engine Board can render
   * avatar stacks (the legacy getTasks board returns these; the views projection
   * did not, leaving assigneesByTaskId empty). Mirrors the assignee result-set
   * `usp_Task_List` produces — one batched join keyed on the page's task ids.
   *
   * Each row gets `Assignees: AssigneeRow[]` in the SAME PascalCase shape the
   * board's TaskCard reads ({ TaskId, UserId, Name, Email, AvatarUrl }).
   */
  private async attachAssignees(pool: sql.ConnectionPool, rows: any[]): Promise<void> {
    for (const r of rows) r.Assignees = [];
    if (rows.length === 0) return;

    const req = pool.request();
    const idParams = rows.map((r, i) => {
      const k = `aid${i}`;
      req.input(k, sql.UniqueIdentifier, r.Id);
      return `@${k}`;
    });
    const res = await req.query(
      `SELECT ta.TaskId, u.Id AS UserId, u.Email, u.Name, u.AvatarUrl ` +
      `FROM TaskAssignees ta JOIN dbo.Users u ON u.Id = ta.UserId ` +
      `WHERE u.DeletedAt IS NULL AND ta.TaskId IN (${idParams.join(', ')}) ` +
      `ORDER BY ta.TaskId, u.Name`,
    );

    const byTask = new Map<string, any[]>();
    for (const a of res.recordset as any[]) {
      const tid = String(a.TaskId).toLowerCase();
      const list = byTask.get(tid) ?? [];
      list.push(a);
      byTask.set(tid, list);
    }
    for (const r of rows) {
      r.Assignees = byTask.get(String(r.Id).toLowerCase()) ?? [];
    }
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

  /**
   * Phase 8d — per-assignee capacity aggregation over the SAME compiled WHERE the
   * view's task page uses (tenant + scope + filter), so it can never leak across
   * workspaces/scopes. Sums TimeEstimateSeconds (8a) and StoryPoints (8c) for each
   * assignee on the in-scope, in-range, non-deleted tasks. `range` bounds on DueDate
   * (NULL bound = unbounded on that side). `groupExpr`/`_fid` join params from the
   * compiler are intentionally NOT applied — capacity has no sort joins.
   */
  async capacityByAssignee(
    compiled: CompiledQuery,
    range: { from: string | null; to: string | null },
  ): Promise<Array<{
    UserId: string; Name: string | null; Email: string | null; AvatarUrl: string | null;
    AssignedSeconds: number; AssignedPoints: number; TaskCount: number;
  }>> {
    const pool = await getPool();
    const req = pool.request();
    for (const [k, v] of Object.entries(compiled.params)) req.input(k, v as any);

    const rangeParts: string[] = [];
    if (range.from) { req.input('__capFrom', sql.Date, range.from); rangeParts.push('t.DueDate >= @__capFrom'); }
    if (range.to)   { req.input('__capTo',   sql.Date, range.to);   rangeParts.push('t.DueDate <= @__capTo'); }
    const rangeSql = rangeParts.length ? ` AND ${rangeParts.join(' AND ')}` : '';

    const res = await req.query(
      `SELECT u.Id AS UserId, u.Name, u.Email, u.AvatarUrl,
              SUM(ISNULL(t.TimeEstimateSeconds, 0)) AS AssignedSeconds,
              SUM(ISNULL(t.StoryPoints, 0))         AS AssignedPoints,
              COUNT(t.Id)                           AS TaskCount
         FROM Tasks t
         JOIN TaskAssignees ta ON ta.TaskId = t.Id
         JOIN dbo.Users u ON u.Id = ta.UserId AND u.DeletedAt IS NULL
        WHERE ${compiled.whereSql}${rangeSql}
        GROUP BY u.Id, u.Name, u.Email, u.AvatarUrl
        ORDER BY u.Name`,
    );
    return res.recordset as any[];
  }
}
