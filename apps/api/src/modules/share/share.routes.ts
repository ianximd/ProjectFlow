import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { shareService } from './share.service.js';
import { accessService } from '../access/access.service.js';
import { TaskRepository } from '../tasks/task.repository.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';
import type { ShareObjectType, HierarchyNodeType } from '@projectflow/types';

const taskRepo = new TaskRepository();

const createSchema = z.object({
  objectType: z.enum(['task', 'doc', 'dashboard', 'view', 'whiteboard']),
  objectId:   z.string().uuid(),
  expiresAt:  z.string().datetime().nullable().optional(),
});

/** The hierarchy node a FULL check runs against for a share object (task -> its List). */
async function fullTarget(objectType: ShareObjectType, objectId: string): Promise<{ type: HierarchyNodeType; id: string } | null> {
  if (objectType === 'task') {
    const t = await taskRepo.getById(objectId);
    const listId = (t as any)?.listId ?? (t as any)?.ListId ?? null;
    return listId ? { type: 'LIST', id: listId } : null;
  }
  return null; // others land with their flows
}

function actorId(c: any): string { const u = c.get('user'); return u?.userId ?? u?.id; }

async function resolveObjectWorkspace(c: any): Promise<string | null> {
  try {
    const body = await c.req.json();
    return body?.objectType && body?.objectId
      ? shareService.getObjectWorkspaceId(body.objectType, body.objectId)
      : null;
  } catch { return null; }
}

export const shareRoutes = new Hono();

// POST /share — create a public read-only link. Requires share.create + FULL on the object.
shareRoutes.post(
  '/',
  zValidator('json', createSchema),
  requirePermission('share.create', { resolveWorkspace: resolveObjectWorkspace }),
  async (c) => {
    const userId = actorId(c);
    const input  = c.req.valid('json');
    const target = await fullTarget(input.objectType, input.objectId);
    if (!target) return c.json({ error: { code: 'NOT_FOUND', message: 'Object not shareable', statusCode: 404 } }, 404);
    if (!(await accessService.can(userId, target.type, target.id, 'FULL')))
      return c.json({ error: { code: 'FORBIDDEN', message: 'FULL access required to share', statusCode: 403 } }, 403);

    const workspaceId = (c as any).get('resolvedWorkspaceId') as string;
    const link = await shareService.createLink(workspaceId, input, userId);
    return c.json({ link }, 201);
  },
);

// DELETE /share/:id — revoke. Authorize-THEN-mutate: read link -> assert FULL -> revoke.
shareRoutes.delete('/:id', async (c) => {
  const userId = actorId(c);
  const id = c.req.param('id');
  const link = await shareService.getLinkById(id);
  if (!link) return c.json({ error: { code: 'NOT_FOUND', message: 'Link not found', statusCode: 404 } }, 404);
  const target = await fullTarget(link.objectType, link.objectId);
  if (!target || !(await accessService.can(userId, target.type, target.id, 'FULL')))
    return c.json({ error: { code: 'FORBIDDEN', message: 'FULL access required', statusCode: 403 } }, 403);
  const revoked = await shareService.revokeLink(id);
  return c.json({ link: revoked });
});

// GET /share/object/:objectType/:objectId — list links for the sharing modal. Requires FULL.
shareRoutes.get('/object/:objectType/:objectId', async (c) => {
  const userId = actorId(c);
  const objectType = c.req.param('objectType') as ShareObjectType;
  const objectId   = c.req.param('objectId');
  const target = await fullTarget(objectType, objectId);
  if (!target || !(await accessService.can(userId, target.type, target.id, 'FULL')))
    return c.json({ error: { code: 'FORBIDDEN', message: 'FULL access required', statusCode: 403 } }, 403);
  const links = await shareService.listForObject(objectType, objectId);
  return c.json({ links });
});
