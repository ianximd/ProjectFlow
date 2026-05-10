import { Hono }        from 'hono';
import { zValidator }  from '@hono/zod-validator';
import { z }           from 'zod';
import { WorkLogService } from './worklog.service.js';

const svc = new WorkLogService();

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
  async (c) => {
    const user = (c as any).get('user') as any;
    const userId = user.userId as string;
    const { taskId, timeSpentSeconds, startedAt, description } = c.req.valid('json');
    const log = await svc.create(taskId, userId, timeSpentSeconds, startedAt, description);
    return c.json({ log }, 201);
  },
);

// PATCH /worklogs/:id
worklogRoutes.patch(
  '/:id',
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

// DELETE /worklogs/:id
worklogRoutes.delete('/:id', async (c) => {
  const id     = c.req.param('id');
  const user   = (c as any).get('user') as any;
  const userId = user.userId as string;
  await svc.delete(id, userId);
  return c.json({ ok: true });
});
