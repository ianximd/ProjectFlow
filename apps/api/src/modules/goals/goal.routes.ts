import { Hono } from 'hono';
import { goalService, InvalidGoalError } from './goal.service.js';
import { GoalRepository } from './goal.repository.js';
import { WorkspaceRepository } from '../workspaces/workspace.repository.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';

export const goalRoutes = new Hono();

const goalRepoForLookup = new GoalRepository();
const workspaceRepoForLookup = new WorkspaceRepository();

const resolveGoalWorkspace = (c: any) => goalRepoForLookup.getGoalWorkspaceId(c.req.param('id'));
const resolveTargetGoalWorkspace = (c: any) => goalRepoForLookup.getGoalWorkspaceId(c.req.param('goalId'));
const resolveBodyWorkspace = async (c: any) => {
  try {
    const body = await c.req.json();
    const wid = body?.workspaceId;
    if (!wid) return null;
    return (await workspaceRepoForLookup.getStatus(wid)) ? wid : null;
  } catch { return null; }
};

function actor(c: any): string {
  const u = c.get('user');
  return u?.userId ?? u?.id;
}

// ── Goal folders ──
// GET /api/v1/goals/folders?workspaceId=
goalRoutes.get('/folders', async (c) => {
  const workspaceId = c.req.query('workspaceId');
  if (!workspaceId) return c.json({ error: { message: 'workspaceId is required' } }, 400);
  return c.json({ data: await goalService.listFolders(workspaceId) });
});

// POST /api/v1/goals/folders
goalRoutes.post('/folders',
  requirePermission('goal.create', { resolveWorkspace: resolveBodyWorkspace }),
  async (c) => {
    const { workspaceId, name } = await c.req.json();
    try {
      const folder = await goalService.createFolder(workspaceId, name, actor(c));
      return c.json({ data: folder }, 201);
    } catch (err: any) {
      if (err instanceof InvalidGoalError) return c.json({ error: { code: err.code, message: err.message } }, 422);
      throw err;
    }
  });

// DELETE /api/v1/goals/folders/:id
goalRoutes.delete('/folders/:id',
  requirePermission('goal.delete', { workspaceParam: 'workspaceId' }),
  async (c) => {
    await goalService.deleteFolder(c.req.param('id')!);
    return c.json({ data: { deleted: true } });
  });

// ── Goals ──
// GET /api/v1/goals?workspaceId=&folderId=
goalRoutes.get('/', async (c) => {
  const workspaceId = c.req.query('workspaceId');
  if (!workspaceId) return c.json({ error: { message: 'workspaceId is required' } }, 400);
  const folderId = c.req.query('folderId') ?? null;
  return c.json({ data: await goalService.listGoals(workspaceId, folderId) });
});

// GET /api/v1/goals/:id  (goal joined with targets + computed progress)
goalRoutes.get('/:id', async (c) => {
  const goal = await goalService.getGoalWithProgress(c.req.param('id')!);
  if (!goal) return c.json({ error: { code: 'NOT_FOUND', message: 'Goal not found' } }, 404);
  return c.json({ data: goal });
});

// POST /api/v1/goals
goalRoutes.post('/',
  requirePermission('goal.create', { resolveWorkspace: resolveBodyWorkspace }),
  async (c) => {
    const body = await c.req.json();
    try {
      const goal = await goalService.createGoal({ ...body, ownerId: actor(c) });
      return c.json({ data: goal }, 201);
    } catch (err: any) {
      if (err instanceof InvalidGoalError) return c.json({ error: { code: err.code, message: err.message } }, 422);
      throw err;
    }
  });

// PATCH /api/v1/goals/:id
goalRoutes.patch('/:id',
  requirePermission('goal.update', { resolveWorkspace: resolveGoalWorkspace }),
  async (c) => {
    const body = await c.req.json();
    try {
      const goal = await goalService.updateGoal(c.req.param('id')!, body);
      if (!goal) return c.json({ error: { code: 'NOT_FOUND', message: 'Goal not found' } }, 404);
      return c.json({ data: goal });
    } catch (err: any) {
      if (err instanceof InvalidGoalError) return c.json({ error: { code: err.code, message: err.message } }, 422);
      throw err;
    }
  });

// DELETE /api/v1/goals/:id
goalRoutes.delete('/:id',
  requirePermission('goal.delete', { resolveWorkspace: resolveGoalWorkspace }),
  async (c) => {
    await goalService.deleteGoal(c.req.param('id')!);
    return c.json({ data: { deleted: true } });
  });

// ── Targets ──
// GET /api/v1/goals/:goalId/targets
goalRoutes.get('/:goalId/targets', async (c) => {
  return c.json({ data: await goalService.listTargets(c.req.param('goalId')!) });
});

// POST /api/v1/goals/:goalId/targets
goalRoutes.post('/:goalId/targets',
  requirePermission('goal.update', { resolveWorkspace: resolveTargetGoalWorkspace }),
  async (c) => {
    const body = await c.req.json();
    try {
      const target = await goalService.createTarget(c.req.param('goalId')!, body);
      return c.json({ data: target }, 201);
    } catch (err: any) {
      if (err instanceof InvalidGoalError) return c.json({ error: { code: err.code, message: err.message } }, 422);
      throw err;
    }
  });

// PATCH /api/v1/goals/:goalId/targets/:targetId
goalRoutes.patch('/:goalId/targets/:targetId',
  requirePermission('goal.update', { resolveWorkspace: resolveTargetGoalWorkspace }),
  async (c) => {
    const body = await c.req.json();
    try {
      const target = await goalService.updateTarget(c.req.param('targetId')!, body);
      if (!target) return c.json({ error: { code: 'NOT_FOUND', message: 'Target not found' } }, 404);
      return c.json({ data: target });
    } catch (err: any) {
      if (err instanceof InvalidGoalError) return c.json({ error: { code: err.code, message: err.message } }, 422);
      throw err;
    }
  });

// DELETE /api/v1/goals/:goalId/targets/:targetId
goalRoutes.delete('/:goalId/targets/:targetId',
  requirePermission('goal.update', { resolveWorkspace: resolveTargetGoalWorkspace }),
  async (c) => {
    await goalService.deleteTarget(c.req.param('targetId')!);
    return c.json({ data: { deleted: true } });
  });
