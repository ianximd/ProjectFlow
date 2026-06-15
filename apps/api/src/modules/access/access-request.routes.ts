import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { accessRequestService } from './access-request.service.js';
import { accessService } from './access.service.js';
import { TaskRepository } from '../tasks/task.repository.js';
import type { ShareObjectType, HierarchyNodeType } from '@projectflow/types';

const taskRepo = new TaskRepository();

const requestSchema = z.object({
  objectType: z.enum(['task', 'doc', 'dashboard', 'view', 'whiteboard']),
  objectId:   z.string().uuid(),
  note:       z.string().max(500).optional(),
});
const resolveSchema = z.object({
  decision: z.enum(['granted', 'denied']),
  level:    z.enum(['VIEW', 'COMMENT', 'EDIT', 'FULL']).optional(),
});

async function fullTarget(objectType: ShareObjectType, objectId: string): Promise<{ type: HierarchyNodeType; id: string } | null> {
  if (objectType === 'task') {
    const t = await taskRepo.getById(objectId);
    const listId = (t as any)?.listId ?? (t as any)?.ListId ?? null;
    return listId ? { type: 'LIST', id: listId } : null;
  }
  return null;
}

function actor(c: any): { id: string; email: string | null } {
  const u = c.get('user');
  return { id: u?.userId ?? u?.id, email: u?.email ?? null };
}

export const accessRequestRoutes = new Hono();

// POST /access/request — any authenticated user may request access to an object.
accessRequestRoutes.post('/request', zValidator('json', requestSchema), async (c) => {
  const a = actor(c);
  const { objectType, objectId, note } = c.req.valid('json');
  try {
    const request = await accessRequestService.requestAccess(objectType, objectId, a.id, note);
    return c.json({ request }, 201);
  } catch (e: any) {
    // Map only the genuine object-not-found sentinel to 404; surface anything
    // else (real 500) instead of masking it as a misleading not-found.
    if (e?.message === 'OBJECT_NOT_FOUND')
      return c.json({ error: { code: 'NOT_FOUND', message: 'Object not found', statusCode: 404 } }, 404);
    throw e;
  }
});

// POST /access/request/:id/resolve — owner/admin grants/denies. Authorize-THEN-mutate
// (read request -> assert FULL on the object -> resolve). A non-FULL caller gets 403
// and NO grant/status mutation happens.
accessRequestRoutes.post('/request/:id/resolve', zValidator('json', resolveSchema), async (c) => {
  const a = actor(c);
  const id = c.req.param('id');
  const { decision, level } = c.req.valid('json');

  const peek = await accessRequestService.getRequestById(id);
  if (!peek) return c.json({ error: { code: 'NOT_FOUND', message: 'Request not found', statusCode: 404 } }, 404);
  const target = await fullTarget(peek.objectType, peek.objectId);
  if (!target || !(await accessService.can(a.id, target.type, target.id, 'FULL')))
    return c.json({ error: { code: 'FORBIDDEN', message: 'FULL access required', statusCode: 403 } }, 403);

  const resolved = await accessRequestService.resolveRequest(id, a.id, decision, level ?? 'EDIT', a.email);
  if (!resolved) return c.json({ error: { code: 'NOT_FOUND', message: 'Request not found', statusCode: 404 } }, 404);
  return c.json({ request: resolved });
});
