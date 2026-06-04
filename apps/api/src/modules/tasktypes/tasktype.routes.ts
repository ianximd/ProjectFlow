import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { taskTypeService } from './tasktype.service.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';
import { pubsub } from '../../graphql/pubsub.js';

export const taskTypeRoutes = new Hono();

const resolveTypeWorkspace = (c: any) => taskTypeService.getWorkspaceId(c.req.param('id'));
async function resolveWorkspaceFromBody(c: any): Promise<string | null> {
  try {
    const body = await c.req.json();
    return body?.workspaceId ?? null;
  } catch {
    return null;
  }
}

const createSchema = z.object({
  workspaceId: z.string().uuid(),
  nameSingular: z.string().min(1).max(100),
  namePlural: z.string().min(1).max(100),
  icon: z.string().max(50).nullable().optional(),
  isMilestone: z.boolean().optional().default(false),
  position: z.number().optional().default(0),
});
const updateSchema = z.object({
  nameSingular: z.string().min(1).max(100).optional(),
  namePlural: z.string().min(1).max(100).optional(),
  icon: z.string().max(50).nullable().optional(),
  clearIcon: z.boolean().optional(),
  position: z.number().optional(),
});

// GET /task-types?workspaceId= — any workspace member (workspace.read).
taskTypeRoutes.get('/',
  requirePermission('workspace.read', { workspaceParam: 'workspaceId' }),
  async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) return c.json({ error: { code: 'BAD_REQUEST', message: 'workspaceId required' } }, 400);
    return c.json({ data: await taskTypeService.list(workspaceId) });
  });

// POST /task-types — manage (label.manage).
taskTypeRoutes.post('/',
  zValidator('json', createSchema),
  requirePermission('label.manage', { resolveWorkspace: resolveWorkspaceFromBody }),
  async (c) => {
    const b = c.req.valid('json');
    try {
      const taskType = await taskTypeService.create(b);
      pubsub.publish('taskType:updated', { workspaceId: b.workspaceId, taskType });
      return c.json({ data: taskType }, 201);
    } catch (err: any) {
      if (err.number === 2627 || err.number === 2601) {
        return c.json({ error: { code: 'TASK_TYPE_NAME_TAKEN', message: 'A task type with that name already exists in this workspace' } }, 409);
      }
      throw err;
    }
  });

// PATCH /task-types/:id — manage.
taskTypeRoutes.patch('/:id',
  requirePermission('label.manage', { resolveWorkspace: resolveTypeWorkspace }),
  zValidator('json', updateSchema),
  async (c) => {
    try {
      const taskType = await taskTypeService.update(c.req.param('id')!, c.req.valid('json'));
      if (!taskType) return c.json({ error: { code: 'NOT_FOUND', message: 'Task type not found' } }, 404);
      pubsub.publish('taskType:updated', { workspaceId: taskType.workspaceId, taskType });
      return c.json({ data: taskType });
    } catch (err: any) {
      if (err.number === 2627 || err.number === 2601) {
        return c.json({ error: { code: 'TASK_TYPE_NAME_TAKEN', message: 'A task type with that name already exists in this workspace' } }, 409);
      }
      throw err;
    }
  });

// DELETE /task-types/:id — manage. Blocks default; reassigns tasks to default.
taskTypeRoutes.delete('/:id',
  requirePermission('label.manage', { resolveWorkspace: resolveTypeWorkspace }),
  async (c) => {
    try {
      const taskType = await taskTypeService.delete(c.req.param('id')!);
      if (!taskType) return c.json({ error: { code: 'NOT_FOUND', message: 'Task type not found' } }, 404);
      pubsub.publish('taskType:updated', { workspaceId: taskType.workspaceId, taskType });
      return c.json({ data: taskType });
    } catch (err: any) {
      if (err.number === 51321) return c.json({ error: { code: 'DEFAULT_TYPE_PROTECTED', message: err.message } }, 409);
      if (err.number === 51320) return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
      throw err;
    }
  });
