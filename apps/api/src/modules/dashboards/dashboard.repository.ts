import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import { getPool } from '../../shared/lib/db.js';
import type {
  Dashboard, DashboardCard, DashboardScopeType, DashboardVisibility, CardConfig, DashboardCardLayout,
} from '@projectflow/types';

function mapDashboard(r: any): Dashboard {
  return {
    id: r.Id, workspaceId: r.WorkspaceId, ownerId: r.OwnerId,
    scopeType: r.ScopeType as DashboardScopeType, scopeId: r.ScopeId ?? null,
    name: r.Name, description: r.Description ?? null,
    visibility: r.Visibility as DashboardVisibility,
    isDefault: Boolean(r.IsDefault), position: r.Position,
  };
}

function mapCard(r: any): DashboardCard {
  return {
    id: r.Id, dashboardId: r.DashboardId, type: r.Type,
    title: r.Title ?? null,
    config: JSON.parse(r.Config) as CardConfig,
    layout: JSON.parse(r.Layout) as DashboardCardLayout,
    position: r.Position,
  };
}

export class DashboardRepository {
  async getWorkspaceId(id: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_Dashboard_GetWorkspaceId',
      [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0]?.WorkspaceId ?? null;
  }

  async create(p: {
    id: string; workspaceId: string; ownerId: string; scopeType: DashboardScopeType;
    scopeId: string | null; scopePath: string | null; name: string; description: string | null;
    visibility: DashboardVisibility; position: number;
  }): Promise<Dashboard> {
    const rows = await execSpOne('usp_Dashboard_Create', [
      { name: 'Id',          type: sql.UniqueIdentifier,  value: p.id },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier,  value: p.workspaceId },
      { name: 'OwnerId',     type: sql.UniqueIdentifier,  value: p.ownerId },
      { name: 'ScopeType',   type: sql.NVarChar(12),      value: p.scopeType },
      { name: 'ScopeId',     type: sql.UniqueIdentifier,  value: p.scopeId },
      { name: 'ScopePath',   type: sql.NVarChar(900),     value: p.scopePath },
      { name: 'Name',        type: sql.NVarChar(200),     value: p.name },
      { name: 'Description', type: sql.NVarChar(sql.MAX), value: p.description },
      { name: 'Visibility',  type: sql.NVarChar(10),      value: p.visibility },
      { name: 'Position',    type: sql.Float,             value: p.position },
    ]);
    return mapDashboard(rows[0]);
  }

  async getById(id: string): Promise<Dashboard | null> {
    const rows = await execSpOne('usp_Dashboard_GetById', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0] ? mapDashboard(rows[0]) : null;
  }

  async update(id: string, p: { name?: string; description?: string | null; visibility?: DashboardVisibility; position?: number }): Promise<Dashboard | null> {
    const rows = await execSpOne('usp_Dashboard_Update', [
      { name: 'Id',          type: sql.UniqueIdentifier,  value: id },
      { name: 'Name',        type: sql.NVarChar(200),     value: p.name ?? null },
      { name: 'Description', type: sql.NVarChar(sql.MAX), value: p.description ?? null },
      { name: 'Visibility',  type: sql.NVarChar(10),      value: p.visibility ?? null },
      { name: 'Position',    type: sql.Float,             value: p.position ?? null },
    ]);
    return rows[0] ? mapDashboard(rows[0]) : null;
  }

  async delete(id: string): Promise<Dashboard | null> {
    const rows = await execSpOne('usp_Dashboard_Delete', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0] ? mapDashboard(rows[0]) : null;
  }

  async listByScope(workspaceId: string, userId: string, scopeType: DashboardScopeType, scopeId: string | null): Promise<Dashboard[]> {
    const rows = await execSpOne('usp_Dashboard_ListByScope', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'UserId',      type: sql.UniqueIdentifier, value: userId },
      { name: 'ScopeType',   type: sql.NVarChar(12),     value: scopeType },
      { name: 'ScopeId',     type: sql.UniqueIdentifier, value: scopeId },
    ]);
    return (rows as any[]).map(mapDashboard);
  }

  async setDefault(id: string): Promise<Dashboard | null> {
    const rows = await execSpOne('usp_Dashboard_SetDefault', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0] ? mapDashboard(rows[0]) : null;
  }

  // ── Cards ────────────────────────────────────────────────────────────────
  async listCards(dashboardId: string): Promise<DashboardCard[]> {
    const pool = await getPool();
    const res = await pool.request()
      .input('DashboardId', sql.UniqueIdentifier, dashboardId)
      .query('SELECT * FROM dbo.DashboardCards WHERE DashboardId = @DashboardId ORDER BY Position ASC, CreatedAt ASC');
    return (res.recordset as any[]).map(mapCard);
  }

  async getCard(id: string): Promise<DashboardCard | null> {
    const pool = await getPool();
    const res = await pool.request().input('Id', sql.UniqueIdentifier, id)
      .query('SELECT * FROM dbo.DashboardCards WHERE Id = @Id');
    return res.recordset[0] ? mapCard(res.recordset[0]) : null;
  }

  async createCard(p: { id: string; dashboardId: string; type: string; title: string | null; config: CardConfig; layout: DashboardCardLayout; position: number }): Promise<DashboardCard> {
    const rows = await execSpOne('usp_DashboardCard_Create', [
      { name: 'Id',          type: sql.UniqueIdentifier,  value: p.id },
      { name: 'DashboardId', type: sql.UniqueIdentifier,  value: p.dashboardId },
      { name: 'Type',        type: sql.NVarChar(24),      value: p.type },
      { name: 'Title',       type: sql.NVarChar(200),     value: p.title },
      { name: 'Config',      type: sql.NVarChar(sql.MAX), value: JSON.stringify(p.config) },
      { name: 'Layout',      type: sql.NVarChar(sql.MAX), value: JSON.stringify(p.layout) },
      { name: 'Position',    type: sql.Float,             value: p.position },
    ]);
    return mapCard(rows[0]);
  }

  async updateCard(id: string, p: { title?: string | null; config?: CardConfig; layout?: DashboardCardLayout; position?: number }): Promise<DashboardCard | null> {
    const rows = await execSpOne('usp_DashboardCard_Update', [
      { name: 'Id',       type: sql.UniqueIdentifier,  value: id },
      { name: 'Title',    type: sql.NVarChar(200),     value: p.title ?? null },
      { name: 'Config',   type: sql.NVarChar(sql.MAX), value: p.config ? JSON.stringify(p.config) : null },
      { name: 'Layout',   type: sql.NVarChar(sql.MAX), value: p.layout ? JSON.stringify(p.layout) : null },
      { name: 'Position', type: sql.Float,             value: p.position ?? null },
    ]);
    return rows[0] ? mapCard(rows[0]) : null;
  }

  async deleteCard(id: string): Promise<DashboardCard | null> {
    const rows = await execSpOne('usp_DashboardCard_Delete', [{ name: 'Id', type: sql.UniqueIdentifier, value: id }]);
    return rows[0] ? mapCard(rows[0]) : null;
  }

  async reorderCards(dashboardId: string, cards: Array<{ id: string; layout: DashboardCardLayout; position: number }>): Promise<DashboardCard[]> {
    // Pass layout as a nested object so the SP's OPENJSON `'$.layout' AS JSON`
    // extracts it (stringifying here would make $.layout a string → AS JSON NULL → NOT NULL violation).
    const payload = JSON.stringify(cards.map((c) => ({ id: c.id, layout: c.layout, position: c.position })));
    const rows = await execSpOne('usp_DashboardCard_Reorder', [
      { name: 'DashboardId', type: sql.UniqueIdentifier,  value: dashboardId },
      { name: 'Cards',       type: sql.NVarChar(sql.MAX), value: payload },
    ]);
    return (rows as any[]).map(mapCard);
  }

  async timeTracked(workspaceId: string, scopePrefix: string | null): Promise<Array<{ userId: string; userName: string; totalSeconds: number }>> {
    const rows = await execSpOne<{ UserId: string; UserName: string; TotalSeconds: number }>('usp_Dashboard_TimeTracked', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'ScopePrefix', type: sql.NVarChar(901),    value: scopePrefix },
    ]);
    return rows.map((r) => ({ userId: r.UserId, userName: r.UserName, totalSeconds: r.TotalSeconds }));
  }
}
