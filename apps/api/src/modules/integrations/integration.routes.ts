import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { integrationService } from './integration.service.js';

export const integrationRoutes = new Hono();

const PROVIDERS = ['slack', 'msteams'] as const;

const VALID_EVENTS = [
  'task.created',
  'task.transitioned',
  'sprint.started',
  'sprint.completed',
] as const;

const createSchema = z.object({
  workspaceId: z.string().uuid(),
  provider:    z.enum(PROVIDERS),
  channelName: z.string().min(1).max(255),
  webhookUrl:  z.string().url().max(2000),
  events:      z.array(z.enum(VALID_EVENTS)).optional(),
});

const testSchema = z.object({
  provider:   z.enum(PROVIDERS),
  webhookUrl: z.string().url().max(2000),
});

// GET /integrations?workspaceId=
integrationRoutes.get('/', async (c) => {
  const workspaceId = c.req.query('workspaceId');
  if (!workspaceId) return c.json({ error: { message: 'workspaceId is required' } }, 400);

  const connections = await integrationService.list(workspaceId);
  return c.json({ data: connections });
});

// POST /integrations
integrationRoutes.post('/', zValidator('json', createSchema), async (c) => {
  const { workspaceId, provider, channelName, webhookUrl, events } = c.req.valid('json');
  const connection = await integrationService.create(
    workspaceId, provider, channelName, webhookUrl, events ?? null,
  );
  return c.json({ data: connection }, 201);
});

// DELETE /integrations/:id
integrationRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await integrationService.delete(id);
  return c.json({ ok: true });
});

// POST /integrations/test  — send a test message without persisting
integrationRoutes.post('/test', zValidator('json', testSchema), async (c) => {
  const { provider, webhookUrl } = c.req.valid('json');
  const result = await integrationService.test(provider, webhookUrl);
  if (!result.ok) {
    return c.json({ error: { message: result.error ?? 'Delivery failed' } }, 502);
  }
  return c.json({ ok: true });
});
