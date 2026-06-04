import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { tagService } from './tag.service.js';
import { ProjectRepository } from '../projects/project.repository.js';
import { requireObjectAccess } from '../access/access.middleware.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';
import { pubsub } from '../../graphql/pubsub.js';

export const tagRoutes = new Hono();
const projectRepo = new ProjectRepository();

const resolveTagWorkspace = (c: any) => tagService.getWorkspaceId(c.req.param('id'));
async function resolveSpaceWorkspaceFromBody(c: any): Promise<string | null> {
  try {
    const body = await c.req.json();
    return body?.spaceId ? await projectRepo.getWorkspaceId(body.spaceId) : null;
  } catch {
    return null;
  }
}

const createSchema = z.object({
  spaceId: z.string().uuid(),
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});

// GET /tags?spaceId= — VIEW on the space.
const listQuery = z.object({ spaceId: z.string().uuid() });
tagRoutes.get('/',
  zValidator('query', listQuery),
  requireObjectAccess('VIEW', (c) => ({ type: 'SPACE', id: c.req.query('spaceId')! })),
  async (c) => c.json({ data: await tagService.list(c.req.query('spaceId')!) }));

// POST /tags — label.manage on the space's workspace; dup name -> 409.
tagRoutes.post('/',
  zValidator('json', createSchema),
  requirePermission('label.manage', { resolveWorkspace: resolveSpaceWorkspaceFromBody }),
  async (c) => {
    const b = c.req.valid('json');
    try {
      const tag = await tagService.create(b.spaceId, b.name, b.color ?? null);
      pubsub.publish('tag:updated', { spaceId: b.spaceId, tag });
      return c.json({ data: tag }, 201);
    } catch (err: any) {
      if (err.number === 2627 || err.number === 2601) {
        return c.json({ error: { code: 'TAG_NAME_TAKEN', message: 'A tag with that name already exists in this space' } }, 409);
      }
      if (err.number === 51340) return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
      throw err;
    }
  });

// DELETE /tags/:id — label.manage (resolve workspace via the tag's space).
tagRoutes.delete('/:id',
  requirePermission('label.manage', { resolveWorkspace: resolveTagWorkspace }),
  async (c) => {
    await tagService.delete(c.req.param('id')!);
    return c.json({ data: { id: c.req.param('id') } });
  });
