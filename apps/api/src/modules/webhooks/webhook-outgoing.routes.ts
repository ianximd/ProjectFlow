import { Hono }    from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z }          from 'zod';
import { webhookOutgoingService } from './webhook-outgoing.service.js';
import { WebhookOutgoingRepository } from './webhook-outgoing.repository.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';

const webhookRepoForLookup = new WebhookOutgoingRepository();
const resolveWebhookWorkspace = (c: any) => webhookRepoForLookup.getWorkspaceId(c.req.param('id'));
async function resolveWorkspaceFromBody(c: any): Promise<string | null> {
  try {
    const body = await c.req.json();
    return body?.workspaceId ?? null;
  } catch {
    return null;
  }
}

const VALID_EVENTS = [
  'issue.created',
  'issue.updated',
  'issue.deleted',
  'sprint.started',
  'sprint.completed',
  'comment.created',
  'member.invited',
] as const;

const createSchema = z.object({
  workspaceId: z.string().uuid(),
  name:        z.string().min(1).max(100),
  url:         z.string().url(),
  secret:      z.string().min(8).max(255),
  events:      z.array(z.enum(VALID_EVENTS)).min(1),
});

export const webhookOutgoingRoutes = new Hono();

// GET  /api/v1/outgoing-webhooks?workspaceId=...
webhookOutgoingRoutes.get('/', async (c) => {
  const workspaceId = c.req.query('workspaceId');
  if (!workspaceId) {
    return c.json({ error: { code: 'MISSING_PARAM', message: 'workspaceId is required', statusCode: 400 } }, 400);
  }
  const webhooks = await webhookOutgoingService.list(workspaceId);
  return c.json({ data: webhooks });
});

// POST /api/v1/outgoing-webhooks
webhookOutgoingRoutes.post(
  '/',
  zValidator('json', createSchema),
  requirePermission('webhook.manage', { resolveWorkspace: resolveWorkspaceFromBody }),
  async (c) => {
  const body = c.req.valid('json');
  const webhook = await webhookOutgoingService.create(body);
  return c.json({ data: webhook }, 201);
  },
);

// DELETE /api/v1/outgoing-webhooks/:id
webhookOutgoingRoutes.delete(
  '/:id',
  requirePermission('webhook.manage', { resolveWorkspace: resolveWebhookWorkspace }),
  async (c) => {
  const id = c.req.param('id')!;
  await webhookOutgoingService.delete(id);
  return c.json({ data: { deleted: true } });
});

// GET /api/v1/outgoing-webhooks/:id/deliveries
webhookOutgoingRoutes.get('/:id/deliveries', async (c) => {
  const id = c.req.param('id');
  const deliveries = await webhookOutgoingService.listDeliveries(id);
  return c.json({ data: deliveries });
});

// POST /api/v1/outgoing-webhooks/:id/ping
webhookOutgoingRoutes.post(
  '/:id/ping',
  requirePermission('webhook.manage', { resolveWorkspace: resolveWebhookWorkspace }),
  async (c) => {
  const id          = c.req.param('id')!;
  const workspaceId = c.req.query('workspaceId') ?? '';
  try {
    const result = await webhookOutgoingService.sendTestPing(id, workspaceId);
    return c.json({ data: result });
  } catch (err: any) {
    return c.json({ error: { code: 'WEBHOOK_NOT_FOUND', message: err.message, statusCode: 404 } }, 404);
  }
});
