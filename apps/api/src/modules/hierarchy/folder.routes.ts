import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { folderService } from './folder.service.js';
import { requireObjectAccess } from '../access/access.middleware.js';
import { accessService } from '../access/access.service.js';
import { pubsub } from '../../graphql/pubsub.js';

export const folderRoutes = new Hono();

const createSchema = z.object({
  workspaceId: z.string().uuid(),
  spaceId: z.string().uuid(),
  parentFolderId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(255),
  position: z.number().default(0),
});

async function parentPathFor(spaceId: string, parentFolderId: string | null): Promise<string | null> {
  if (!parentFolderId) return folderService.spacePath(spaceId);
  const parent = await folderService.getById(parentFolderId);
  return parent ? (parent as any).Path : null;
}

folderRoutes.post('/', zValidator('json', createSchema),
  requireObjectAccess('EDIT', (c) => {
    const b = (c.req as any).valid('json');
    return b.parentFolderId ? { type: 'FOLDER', id: b.parentFolderId } : { type: 'SPACE', id: b.spaceId };
  }),
  async (c) => {
    const b = c.req.valid('json');
    const parentPath = await parentPathFor(b.spaceId, b.parentFolderId ?? null);
    if (!parentPath) return c.json({ error: { code: 'NOT_FOUND', message: 'Parent not found' } }, 404);
    const folder = await folderService.create({ ...b, parentFolderId: b.parentFolderId ?? null, parentPath });
    pubsub.publish('folder:updated', { spaceId: b.spaceId, folder });
    return c.json({ data: folder }, 201);
  },
);

folderRoutes.get('/', zValidator('query', z.object({ spaceId: z.string().uuid() })),
  requireObjectAccess('VIEW', (c) => ({ type: 'SPACE', id: c.req.query('spaceId')! })),
  async (c) => {
    const userId = ((c as any).get('user') as any).userId as string;
    const folders = await folderService.list(c.req.query('spaceId')!);
    const visible = await accessService.filterVisibleNodes(userId, 'FOLDER', folders as any[]);
    return c.json({ data: visible });
  },
);

const updateSchema = z.object({ name: z.string().min(1).max(255).optional(), workflowId: z.string().uuid().nullable().optional() });
folderRoutes.patch('/:id', zValidator('json', updateSchema),
  requireObjectAccess('EDIT', (c) => ({ type: 'FOLDER', id: c.req.param('id')! })),
  async (c) => {
    const { name, workflowId } = c.req.valid('json');
    const folder = await folderService.update(c.req.param('id')!, name, workflowId ?? undefined, workflowId === null);
    pubsub.publish('folder:updated', { spaceId: (folder as any).SpaceId, folder });
    return c.json({ data: folder });
  },
);

const moveSchema = z.object({ parentFolderId: z.string().uuid().nullable(), position: z.number(), spaceId: z.string().uuid() });
folderRoutes.patch('/:id/move', zValidator('json', moveSchema),
  requireObjectAccess('EDIT', (c) => ({ type: 'FOLDER', id: c.req.param('id')! })),
  async (c) => {
    const { parentFolderId, position, spaceId } = c.req.valid('json');
    const newParentPath = await parentPathFor(spaceId, parentFolderId);
    if (!newParentPath) return c.json({ error: { code: 'NOT_FOUND', message: 'Parent not found' } }, 404);
    try {
      const folder = await folderService.move(c.req.param('id')!, parentFolderId, position, newParentPath);
      pubsub.publish('folder:updated', { spaceId, folder });
      return c.json({ data: folder });
    } catch (err: any) {
      if (err.number === 51203) return c.json({ error: { code: 'UNPROCESSABLE', message: err.message } }, 422);
      throw err;
    }
  },
);

folderRoutes.delete('/:id',
  requireObjectAccess('FULL', (c) => ({ type: 'FOLDER', id: c.req.param('id')! })),
  async (c) => {
    try {
      const folder = await folderService.delete(c.req.param('id')!);
      pubsub.publish('folder:updated', { spaceId: (folder as any).SpaceId, folder });
      return c.json({ data: folder });
    } catch (err: any) {
      if (err.number === 51204) return c.json({ error: { code: 'CONFLICT', message: err.message } }, 409);
      throw err;
    }
  },
);
