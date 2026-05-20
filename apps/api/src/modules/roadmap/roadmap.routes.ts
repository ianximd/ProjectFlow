import { Hono } from 'hono';
import { RoadmapService } from './roadmap.service.js';
import { TaskRepository } from '../tasks/task.repository.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';
import { cacheDelPattern } from '../../shared/lib/cache.js';

const svc    = new RoadmapService();
export const roadmapRoutes = new Hono();

// Roadmap writes (date drags, dependency edges) mutate task data that the
// cached GET /roadmap (and /epics, /sprints) responses surface. Without this,
// a successful PATCH leaves the stale cached roadmap in place for the whole
// TTL — the dragged bar appears to "snap back" because the refetch is served
// from cache. Mirrors invalidateTaskCaches() in task.routes.ts.
async function invalidateRoadmapCaches(): Promise<void> {
  try {
    await Promise.all([
      cacheDelPattern('http:*:/api/v1/roadmap*'),
      cacheDelPattern('http:*:/api/v1/epics*'),
      cacheDelPattern('http:*:/api/v1/sprints*'),
    ]);
  } catch { /* cache invalidation is best-effort — never fail the write */ }
}

// Roadmap operations are all task mutations (date changes, dependency edges),
// so we reuse the task.update permission and look up workspace from the task.
const taskRepoForLookup = new TaskRepository();
const resolveTaskWorkspaceFromParam   = (c: any) => taskRepoForLookup.getWorkspaceId(c.req.param('id'));
const resolveTaskWorkspaceFromTaskParam = (c: any) => taskRepoForLookup.getWorkspaceId(c.req.param('taskId'));
async function resolveTaskWorkspaceFromBody(c: any): Promise<string | null> {
  try {
    const body = await c.req.json();
    return body?.taskId ? await taskRepoForLookup.getWorkspaceId(body.taskId) : null;
  } catch {
    return null;
  }
}

// GET /roadmap?projectId=...&workspaceId=...&from=...&to=...
roadmapRoutes.get('/', async (c) => {
  const { projectId, workspaceId, from, to } = c.req.query();

  if (!projectId && !workspaceId) {
    return c.json({ error: 'projectId or workspaceId is required' }, 400);
  }

  try {
    const result = await svc.getItems(
      projectId  || null,
      workspaceId || null,
      from || null,
      to   || null,
    );
    return c.json({ data: result });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// PATCH /roadmap/tasks/:id/dates
roadmapRoutes.patch(
  '/tasks/:id/dates',
  requirePermission('task.update', { resolveWorkspace: resolveTaskWorkspaceFromParam }),
  async (c) => {
  const taskId     = c.req.param('id')!;
  const user       = (c as any).get('user') as any;
  const body       = await c.req.json().catch(() => ({}));

  const { startDate, dueDate, clearStartDate, clearDueDate } = body as {
    startDate?: string | null;
    dueDate?: string | null;
    clearStartDate?: boolean;
    clearDueDate?: boolean;
  };

  try {
    const row = await svc.updateDates(
      taskId,
      user.userId,
      startDate,
      dueDate,
      clearStartDate,
      clearDueDate,
    );
    await invalidateRoadmapCaches();
    return c.json({ data: row });
  } catch (err: any) {
    const status = err.message?.includes('not found') ? 404 : 400;
    return c.json({ error: err.message }, status);
  }
});

// POST /roadmap/dependencies
roadmapRoutes.post(
  '/dependencies',
  requirePermission('task.update', { resolveWorkspace: resolveTaskWorkspaceFromBody }),
  async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { taskId, dependsOn, type } = body as {
    taskId: string;
    dependsOn: string;
    type?: string;
  };

  if (!taskId || !dependsOn) {
    return c.json({ error: 'taskId and dependsOn are required' }, 400);
  }

  try {
    const dep = await svc.addDependency(taskId, dependsOn, type);
    await invalidateRoadmapCaches();
    return c.json({ data: dep }, 201);
  } catch (err: any) {
    const status = err.message?.includes('Circular') ? 409 : 400;
    return c.json({ error: err.message }, status);
  }
});

// DELETE /roadmap/dependencies/:taskId/:dependsOn
roadmapRoutes.delete(
  '/dependencies/:taskId/:dependsOn',
  requirePermission('task.update', { resolveWorkspace: resolveTaskWorkspaceFromTaskParam }),
  async (c) => {
  const { taskId, dependsOn } = c.req.param();
  await svc.removeDependency(taskId, dependsOn);
  await invalidateRoadmapCaches();
  return c.body(null, 204);
});
