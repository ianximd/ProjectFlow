import { Hono } from 'hono';
import { ReportsService } from './reports.service.js';

const svc = new ReportsService();
export const reportsRoutes = new Hono();

// GET /reports/burndown?sprintId=
reportsRoutes.get('/burndown', async (c) => {
  const sprintId = c.req.query('sprintId');
  if (!sprintId) return c.json({ error: 'sprintId is required' }, 400);

  try {
    const data = await svc.burndown(sprintId);
    if (!data) return c.json({ error: 'Sprint not found' }, 404);
    return c.json({ data });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// GET /reports/velocity?projectId=&numSprints=5
reportsRoutes.get('/velocity', async (c) => {
  const projectId  = c.req.query('projectId');
  const numSprints = parseInt(c.req.query('numSprints') ?? '5', 10);

  if (!projectId) return c.json({ error: 'projectId is required' }, 400);

  try {
    const data = await svc.velocity(projectId, numSprints);
    return c.json({ data });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// GET /reports/sprint-summary?sprintId=
reportsRoutes.get('/sprint-summary', async (c) => {
  const sprintId = c.req.query('sprintId');
  if (!sprintId) return c.json({ error: 'sprintId is required' }, 400);

  try {
    const data = await svc.sprintSummary(sprintId);
    if (!data) return c.json({ error: 'Sprint not found' }, 404);
    return c.json({ data });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// GET /reports/workload?projectId=
reportsRoutes.get('/workload', async (c) => {
  const projectId = c.req.query('projectId');
  if (!projectId) return c.json({ error: 'projectId is required' }, 400);

  try {
    const data = await svc.workload(projectId);
    return c.json({ data });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// GET /reports/created-vs-resolved?projectId=&weeks=8
reportsRoutes.get('/created-vs-resolved', async (c) => {
  const projectId = c.req.query('projectId');
  const weeks     = parseInt(c.req.query('weeks') ?? '8', 10);

  if (!projectId) return c.json({ error: 'projectId is required' }, 400);

  try {
    const data = await svc.createdVsResolved(projectId, weeks);
    return c.json({ data });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});
