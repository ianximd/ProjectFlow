import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { HierarchyNodeType } from '@projectflow/types';
import { accessService } from './access.service.js';
import { requireObjectAccess } from './access.middleware.js';
import { HierarchyRepository } from '../hierarchy/hierarchy.repository.js';

export const accessRoutes = new Hono();
const hierarchyRepo = new HierarchyRepository();

const setSchema = z.object({
  subjectType: z.enum(['USER', 'ROLE']),
  subjectId:   z.string().uuid(),
  level:       z.enum(['VIEW', 'COMMENT', 'EDIT', 'FULL']),
});
const removeSchema = z.object({
  subjectType: z.enum(['USER', 'ROLE']),
  subjectId:   z.string().uuid(),
});

function obj(c: any): { type: HierarchyNodeType; id: string } {
  return { type: c.req.param('objectType') as HierarchyNodeType, id: c.req.param('objectId')! };
}
function actor(c: any): { id: string; email: string | null } {
  const u = c.get('user');
  return { id: u?.userId ?? u?.id, email: u?.email ?? null };
}

/** GET /access/:objectType/:objectId/permissions — effective grant list (incl. inherited) */
accessRoutes.get('/:objectType/:objectId/permissions', requireObjectAccess('FULL', obj), async (c) => {
  const { type, id } = obj(c);
  return c.json({ data: await accessService.listObjectPermissions(type, id) });
});

/** PUT /access/:objectType/:objectId/permissions — add/change a grant */
accessRoutes.put('/:objectType/:objectId/permissions', requireObjectAccess('FULL', obj), zValidator('json', setSchema), async (c) => {
  const { type, id } = obj(c);
  const { subjectType, subjectId, level } = c.req.valid('json');
  const workspaceId = await hierarchyRepo.getWorkspaceIdForNode(type, id);
  if (!workspaceId) return c.json({ error: { code: 'NOT_FOUND', message: 'Resource not found', statusCode: 404 } }, 404);
  const a = actor(c);
  await accessService.setObjectPermission({ workspaceId, subjectType, subjectId, objectType: type, objectId: id, level, actorId: a.id, actorEmail: a.email });
  return c.json({ data: await accessService.listObjectPermissions(type, id) });
});

/** DELETE /access/:objectType/:objectId/permissions — revoke a grant on THIS object */
accessRoutes.delete('/:objectType/:objectId/permissions', requireObjectAccess('FULL', obj), zValidator('json', removeSchema), async (c) => {
  const { type, id } = obj(c);
  const { subjectType, subjectId } = c.req.valid('json');
  const workspaceId = await hierarchyRepo.getWorkspaceIdForNode(type, id);
  if (!workspaceId) return c.json({ error: { code: 'NOT_FOUND', message: 'Resource not found', statusCode: 404 } }, 404);
  const a = actor(c);
  const removed = await accessService.removeObjectPermission({ workspaceId, subjectType, subjectId, objectType: type, objectId: id, actorId: a.id, actorEmail: a.email });
  if (!removed) return c.json({ error: { code: 'NOT_FOUND', message: 'Grant not found', statusCode: 404 } }, 404);
  return c.json({ data: await accessService.listObjectPermissions(type, id) });
});
