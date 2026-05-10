import { Hono }             from 'hono';
import { zValidator }       from '@hono/zod-validator';
import { z }                from 'zod';
import { AutomationService } from './automation.service.js';
import type { Variables }    from '../../server.js';

const svc = new AutomationService();

const triggerSchema = z.object({
  type:           z.string().min(1),
  cron:           z.string().optional(),
  toStatus:       z.string().optional(),
  hoursBeforeDue: z.number().optional(),
});

const conditionSchema = z.object({
  type:  z.string().min(1),
  field: z.string().optional(),
  value: z.string().optional(),
  pql:   z.string().optional(),
});

const actionSchema = z.object({
  type:        z.string().min(1),
  toStatus:    z.string().optional(),
  assigneeId:  z.string().optional(),
  priority:    z.string().optional(),
  message:     z.string().optional(),
  webhookUrl:  z.string().url().optional(),
});

const createSchema = z.object({
  projectId:  z.string().uuid(),
  name:       z.string().min(1).max(255),
  trigger:    triggerSchema,
  conditions: z.array(conditionSchema).default([]),
  actions:    z.array(actionSchema).min(1),
});

const updateSchema = z.object({
  name:       z.string().min(1).max(255).optional(),
  isEnabled:  z.boolean().optional(),
  trigger:    triggerSchema.optional(),
  conditions: z.array(conditionSchema).optional(),
  actions:    z.array(actionSchema).optional(),
});

export const automationRoutes = new Hono<{ Variables: Variables }>();

// GET /automations?projectId=
automationRoutes.get('/', async (c) => {
  const projectId = c.req.query('projectId');
  if (!projectId) return c.json({ error: 'projectId required' }, 400);
  const rules = await svc.list(projectId);
  return c.json({ rules });
});

// POST /automations
automationRoutes.post(
  '/',
  zValidator('json', createSchema),
  async (c) => {
    const { projectId, name, trigger, conditions, actions } = c.req.valid('json');
    const rule = await svc.create(projectId, name, trigger as any, conditions as any, actions as any);
    return c.json({ rule }, 201);
  },
);

// PATCH /automations/:id
automationRoutes.patch(
  '/:id',
  zValidator('json', updateSchema),
  async (c) => {
    const id   = c.req.param('id');
    const patch = c.req.valid('json');
    const rule  = await svc.update(id, patch as any);
    if (!rule) return c.json({ error: 'Not found' }, 404);
    return c.json({ rule });
  },
);

// POST /automations/:id/toggle  — enable / disable
automationRoutes.post('/:id/toggle', async (c) => {
  const id   = c.req.param('id');
  const body = await c.req.json<{ isEnabled: boolean }>();
  const rule  = await svc.update(id, { isEnabled: Boolean(body.isEnabled) });
  if (!rule) return c.json({ error: 'Not found' }, 404);
  return c.json({ rule });
});

// DELETE /automations/:id
automationRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await svc.delete(id);
  return c.json({ ok: true });
});
