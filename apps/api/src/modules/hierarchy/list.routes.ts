import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { listService } from './list.service.js';
import { requireObjectAccess } from '../access/access.middleware.js';
import { pubsub } from '../../graphql/pubsub.js';

export const listRoutes = new Hono();

const createSchema = z.object({
  workspaceId: z.string().uuid(),
  spaceId: z.string().uuid(),
  folderId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(255),
  position: z.number().default(0),
});

listRoutes.post('/', zValidator('json', createSchema),
  requireObjectAccess('EDIT', (c) => {
    const b = (c.req as any).valid('json');
    return b.folderId ? { type: 'FOLDER', id: b.folderId } : { type: 'SPACE', id: b.spaceId };
  }),
  async (c) => {
    const b = c.req.valid('json');
    const parentPath = await listService.parentPath(b.spaceId, b.folderId ?? null);
    if (!parentPath) return c.json({ error: { code: 'NOT_FOUND', message: 'Parent not found' } }, 404);
    const list = await listService.create({ ...b, folderId: b.folderId ?? null, parentPath });
    pubsub.publish('list:updated', { spaceId: b.spaceId, list });
    return c.json({ data: list }, 201);
  },
);

const listQuery = z.object({ spaceId: z.string().uuid(), folderId: z.string().uuid().optional() });
listRoutes.get('/', zValidator('query', listQuery),
  requireObjectAccess('VIEW', (c) => ({ type: 'SPACE', id: c.req.query('spaceId')! })),
  async (c) => {
    const folderId = c.req.query('folderId') ?? null;
    const allInSpace = folderId === null;
    return c.json({ data: await listService.list(c.req.query('spaceId')!, folderId, allInSpace) });
  },
);

const updateSchema = z.object({ name: z.string().min(1).max(255).optional(), workflowId: z.string().uuid().nullable().optional() });
listRoutes.patch('/:id', zValidator('json', updateSchema),
  requireObjectAccess('EDIT', (c) => ({ type: 'LIST', id: c.req.param('id')! })),
  async (c) => {
    const { name, workflowId } = c.req.valid('json');
    const list = await listService.update(c.req.param('id')!, name, workflowId ?? undefined, workflowId === null);
    pubsub.publish('list:updated', { spaceId: (list as any).SpaceId, list });
    return c.json({ data: list });
  },
);

const moveSchema = z.object({ folderId: z.string().uuid().nullable(), position: z.number(), spaceId: z.string().uuid() });
listRoutes.patch('/:id/move', zValidator('json', moveSchema),
  requireObjectAccess('EDIT', (c) => ({ type: 'LIST', id: c.req.param('id')! })),
  async (c) => {
    const { folderId, position, spaceId } = c.req.valid('json');
    const newParentPath = await listService.parentPath(spaceId, folderId);
    if (!newParentPath) return c.json({ error: { code: 'NOT_FOUND', message: 'Parent not found' } }, 404);
    const list = await listService.move(c.req.param('id')!, folderId, position, newParentPath);
    pubsub.publish('list:updated', { spaceId, list });
    return c.json({ data: list });
  },
);

listRoutes.delete('/:id',
  requireObjectAccess('FULL', (c) => ({ type: 'LIST', id: c.req.param('id')! })),
  async (c) => {
    try {
      const list = await listService.delete(c.req.param('id')!);
      pubsub.publish('list:updated', { spaceId: (list as any).SpaceId, list });
      return c.json({ data: list });
    } catch (err: any) {
      if (err.number === 51211 || err.number === 51212) return c.json({ error: { code: 'CONFLICT', message: err.message } }, 409);
      throw err;
    }
  },
);

listRoutes.get('/:id/effective-statuses',
  requireObjectAccess('VIEW', (c) => ({ type: 'LIST', id: c.req.param('id')! })),
  async (c) => c.json({ data: await listService.effectiveStatuses(c.req.param('id')!) }),
);
