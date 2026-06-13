import { Hono } from 'hono';
import type { Context } from 'hono';
import { ReportsService } from './reports.service.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';
import { sprintService } from '../sprints/sprint.service.js';
import { projectService } from '../projects/project.service.js';
import { CustomFieldRepository } from '../customfields/customfield.repository.js';

const svc = new ReportsService();
const cfRepo = new CustomFieldRepository();
export const reportsRoutes = new Hono();

// ── Workspace resolvers for the report.read gate. Each derives the workspace
// from the route's identifying query param and FAILS CLOSED (returns null →
// requirePermission answers 404) on a missing/unresolvable/cross-tenant id.
async function resolveSprintWs(c: Context): Promise<string | null> {
  try {
    const id = c.req.query('sprintId');
    if (!id) return null;
    return await sprintService.getSprintWorkspaceId(id);
  } catch { return null; }
}
async function resolveProjectWs(c: Context): Promise<string | null> {
  try {
    const id = c.req.query('projectId');
    if (!id) return null;
    const p = await projectService.getById(id);
    return (p as any)?.WorkspaceId ?? null;
  } catch { return null; }
}
async function resolveScopeWs(c: Context): Promise<string | null> {
  try {
    const st = c.req.query('scopeType');
    const si = c.req.query('scopeId');
    if (!st || !si) return null;
    const node = await cfRepo.getScopeNode(st.toUpperCase() as any, si);
    return node?.workspaceId ?? null;
  } catch { return null; }
}
// Portfolio spans a SET of scopes; require they all resolve to ONE workspace
// (a scope set crossing workspaces fails closed → no cross-tenant rollup).
async function resolvePortfolioWs(c: Context): Promise<string | null> {
  try {
    const st = c.req.query('scopeType');
    const ids = (c.req.query('scopeIds') ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (!st || ids.length === 0) return null;
    let ws: string | null = null;
    for (const id of ids) {
      const node = await cfRepo.getScopeNode(st.toUpperCase() as any, id);
      const w = node?.workspaceId ?? null;
      if (!w) return null;
      if (ws === null) ws = w;
      else if (w !== ws) return null;
    }
    return ws;
  } catch { return null; }
}

// GET /reports/burndown?sprintId=
reportsRoutes.get('/burndown',
  requirePermission('report.read', { resolveWorkspace: resolveSprintWs }),
  async (c) => {
    const sprintId = c.req.query('sprintId')!;
    try {
      const data = await svc.burndown(sprintId);
      if (!data) return c.json({ error: 'Sprint not found' }, 404);
      return c.json({ data });
    } catch (err: any) { return c.json({ error: err.message }, 500); }
  });

// GET /reports/velocity?projectId=&numSprints=5
reportsRoutes.get('/velocity',
  requirePermission('report.read', { resolveWorkspace: resolveProjectWs }),
  async (c) => {
    const projectId  = c.req.query('projectId')!;
    const numSprints = parseInt(c.req.query('numSprints') ?? '5', 10);
    try {
      const data = await svc.velocity(projectId, numSprints);
      return c.json({ data });
    } catch (err: any) { return c.json({ error: err.message }, 500); }
  });

// GET /reports/sprint-summary?sprintId=
reportsRoutes.get('/sprint-summary',
  requirePermission('report.read', { resolveWorkspace: resolveSprintWs }),
  async (c) => {
    const sprintId = c.req.query('sprintId')!;
    try {
      const data = await svc.sprintSummary(sprintId);
      if (!data) return c.json({ error: 'Sprint not found' }, 404);
      return c.json({ data });
    } catch (err: any) { return c.json({ error: err.message }, 500); }
  });

// GET /reports/workload?projectId=
reportsRoutes.get('/workload',
  requirePermission('report.read', { resolveWorkspace: resolveProjectWs }),
  async (c) => {
    const projectId = c.req.query('projectId')!;
    try {
      const data = await svc.workload(projectId);
      return c.json({ data });
    } catch (err: any) { return c.json({ error: err.message }, 500); }
  });

// GET /reports/created-vs-resolved?projectId=&weeks=8
reportsRoutes.get('/created-vs-resolved',
  requirePermission('report.read', { resolveWorkspace: resolveProjectWs }),
  async (c) => {
    const projectId = c.req.query('projectId')!;
    const weeks     = parseInt(c.req.query('weeks') ?? '8', 10);
    try {
      const data = await svc.createdVsResolved(projectId, weeks);
      return c.json({ data });
    } catch (err: any) { return c.json({ error: err.message }, 500); }
  });

// GET /reports/burnup?sprintId=
reportsRoutes.get('/burnup',
  requirePermission('report.read', { resolveWorkspace: resolveSprintWs }),
  async (c) => {
    const sprintId = c.req.query('sprintId')!;
    try {
      const data = await svc.burnup(sprintId);
      if (!data) return c.json({ error: 'Sprint not found' }, 404);
      return c.json({ data });
    } catch (err: any) { return c.json({ error: err.message }, 500); }
  });

// GET /reports/cumulative-flow?scopeType=&scopeId=&weeks=8
reportsRoutes.get('/cumulative-flow',
  requirePermission('report.read', { resolveWorkspace: resolveScopeWs }),
  async (c) => {
    const scopeType = c.req.query('scopeType')!;
    const scopeId   = c.req.query('scopeId')!;
    const weeks     = parseInt(c.req.query('weeks') ?? '8', 10);
    try {
      const data = await svc.cumulativeFlow(scopeType, scopeId, weeks);
      return c.json({ data });
    } catch (err: any) { return c.json({ error: err.message }, 500); }
  });

// GET /reports/lead-cycle-time?scopeType=&scopeId=&weeks=12
reportsRoutes.get('/lead-cycle-time',
  requirePermission('report.read', { resolveWorkspace: resolveScopeWs }),
  async (c) => {
    const scopeType = c.req.query('scopeType')!;
    const scopeId   = c.req.query('scopeId')!;
    const weeks     = parseInt(c.req.query('weeks') ?? '12', 10);
    try {
      const data = await svc.leadCycleTime(scopeType, scopeId, weeks);
      return c.json({ data });
    } catch (err: any) { return c.json({ error: err.message }, 500); }
  });

// GET /reports/portfolio?scopeType=&scopeIds=id1,id2
reportsRoutes.get('/portfolio',
  requirePermission('report.read', { resolveWorkspace: resolvePortfolioWs }),
  async (c) => {
    const scopeType = c.req.query('scopeType')!;
    const scopeIds  = (c.req.query('scopeIds') ?? '').split(',').map(s => s.trim()).filter(Boolean);
    try {
      const data = await svc.portfolio(scopeType, scopeIds);
      return c.json({ data });
    } catch (err: any) { return c.json({ error: err.message }, 500); }
  });
