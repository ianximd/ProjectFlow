import { Hono } from 'hono';
import { RoadmapService } from './roadmap.service.js';

const svc    = new RoadmapService();
export const roadmapRoutes = new Hono();

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
roadmapRoutes.patch('/tasks/:id/dates', async (c) => {
  const taskId     = c.req.param('id');
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
    return c.json({ data: row });
  } catch (err: any) {
    const status = err.message?.includes('not found') ? 404 : 400;
    return c.json({ error: err.message }, status);
  }
});

// POST /roadmap/dependencies
roadmapRoutes.post('/dependencies', async (c) => {
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
    return c.json({ data: dep }, 201);
  } catch (err: any) {
    const status = err.message?.includes('Circular') ? 409 : 400;
    return c.json({ error: err.message }, status);
  }
});

// DELETE /roadmap/dependencies/:taskId/:dependsOn
roadmapRoutes.delete('/dependencies/:taskId/:dependsOn', async (c) => {
  const { taskId, dependsOn } = c.req.param();
  await svc.removeDependency(taskId, dependsOn);
  return c.body(null, 204);
});
