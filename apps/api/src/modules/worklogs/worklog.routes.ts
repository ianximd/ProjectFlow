import { Hono }        from 'hono';
import { zValidator }  from '@hono/zod-validator';
import { z }           from 'zod';
import { WorkLogService } from './worklog.service.js';
import { WorkLogRepository } from './worklog.repository.js';
import { TaskRepository } from '../tasks/task.repository.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';

const svc = new WorkLogService();

// RBAC resolvers
const worklogRepoForLookup = new WorkLogRepository();
const taskRepoForLookup    = new TaskRepository();

async function loadWorklogContext(c: any): Promise<{ workspaceId: string; ownerId: string } | null> {
  const cached = c.get('worklogContext') as { workspaceId: string; ownerId: string } | null | undefined;
  if (cached !== undefined) return cached;
  const ctx = await worklogRepoForLookup.getContext(c.req.param('id')!);
  c.set('worklogContext', ctx);
  return ctx;
}
const resolveWorklogWorkspace = async (c: any) => (await loadWorklogContext(c))?.workspaceId ?? null;
const resolveWorklogOwner     = async (c: any) => (await loadWorklogContext(c))?.ownerId ?? null;

async function resolveTaskWorkspaceFromBody(c: any): Promise<string | null> {
  try {
    const body = await c.req.json();
    return body?.taskId ? await taskRepoForLookup.getWorkspaceId(body.taskId) : null;
  } catch {
    return null;
  }
}

const createSchema = z.object({
  taskId:           z.string().uuid(),
  timeSpentSeconds: z.number().int().positive(),
  startedAt:        z.string().datetime(),
  description:      z.string().max(500).optional(),
});

const updateSchema = z.object({
  timeSpentSeconds: z.number().int().positive().optional(),
  startedAt:        z.string().datetime().optional(),
  description:      z.string().max(500).optional(),
});

export const worklogRoutes = new Hono();

// GET /worklogs?taskId=
worklogRoutes.get('/', async (c) => {
  const taskId = c.req.query('taskId');
  if (!taskId) return c.json({ error: 'taskId required' }, 400);
  const result = await svc.listByTask(taskId);
  return c.json(result);
});

// POST /worklogs
worklogRoutes.post(
  '/',
  zValidator('json', createSchema),
  requirePermission('worklog.create', { resolveWorkspace: resolveTaskWorkspaceFromBody }),
  async (c) => {
    const user = (c as any).get('user') as any;
    const userId = user.userId as string;
    const { taskId, timeSpentSeconds, startedAt, description } = c.req.valid('json');
    const log = await svc.create(taskId, userId, timeSpentSeconds, startedAt, description);
    return c.json({ log }, 201);
  },
);

// PATCH /worklogs/:id  — owner-only
worklogRoutes.patch(
  '/:id',
  requirePermission('worklog.update.own', {
    resolveWorkspace: resolveWorklogWorkspace,
    ownerOnly: resolveWorklogOwner,
  }),
  zValidator('json', updateSchema),
  async (c) => {
    const id     = c.req.param('id');
    const user   = (c as any).get('user') as any;
    const userId = user.userId as string;
    const patch  = c.req.valid('json');
    const log    = await svc.update(id, userId, patch);
    if (!log) return c.json({ error: 'Not found or forbidden' }, 404);
    return c.json({ log });
  },
);

// DELETE /worklogs/:id  — admins (.any) or the author (.own)
worklogRoutes.delete(
  '/:id',
  requirePermission('worklog.delete.any', {
    resolveWorkspace: resolveWorklogWorkspace,
    ownerFallback: { slug: 'worklog.delete.own', resolveOwner: resolveWorklogOwner },
  }),
  async (c) => {
  const id     = c.req.param('id')!;
  const user   = (c as any).get('user') as any;
  const userId = user.userId as string;
  await svc.delete(id, userId);
  return c.json({ ok: true });
});
