import { Hono }        from 'hono';
import { zValidator }  from '@hono/zod-validator';
import { z }           from 'zod';
import { VersionService } from './version.service.js';
import { cacheDelPattern } from '../../shared/lib/cache.js';

function invalidateVersionCache(projectId: string): void {
  cacheDelPattern(`http:*:/api/v1/versions?projectId=${projectId}*`).catch(() => {});
}

const svc = new VersionService();

const createSchema = z.object({
  projectId:   z.string().uuid(),
  name:        z.string().min(1).max(100),
  description: z.string().max(2000).optional().nullable(),
  startDate:   z.string().optional().nullable(),
  releaseDate: z.string().optional().nullable(),
});

const updateSchema = z.object({
  name:        z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional().nullable(),
  status:      z.enum(['UNRELEASED', 'RELEASED', 'ARCHIVED']).optional(),
  startDate:   z.string().optional().nullable(),
  releaseDate: z.string().optional().nullable(),
});

export const versionRoutes = new Hono();

// GET /versions?projectId=
versionRoutes.get('/', async (c) => {
  const projectId = c.req.query('projectId');
  if (!projectId) return c.json({ error: 'projectId required' }, 400);
  const versions = await svc.list(projectId);
  return c.json({ versions });
});

// POST /versions
versionRoutes.post(
  '/',
  zValidator('json', createSchema),
  async (c) => {
    const { projectId, name, description, startDate, releaseDate } = c.req.valid('json');
    const version = await svc.create(
      projectId, name,
      description ?? null,
      startDate   ?? null,
      releaseDate ?? null,
    );
    invalidateVersionCache(projectId);
    return c.json({ version }, 201);
  },
);

// PATCH /versions/:id
versionRoutes.patch(
  '/:id',
  zValidator('json', updateSchema),
  async (c) => {
    const id      = c.req.param('id');
    const patch   = c.req.valid('json');
    const version = await svc.update(id, patch);
    if (!version) return c.json({ error: 'Not found' }, 404);
    invalidateVersionCache(version.projectId);
    return c.json({ version });
  },
);

// POST /versions/:id/release  — shortcut to set status = RELEASED
versionRoutes.post('/:id/release', async (c) => {
  const version = await svc.update(c.req.param('id'), { status: 'RELEASED' });
  if (!version) return c.json({ error: 'Not found' }, 404);
  invalidateVersionCache(version.projectId);
  return c.json({ version });
});

// POST /versions/:id/archive  — shortcut to set status = ARCHIVED
versionRoutes.post('/:id/archive', async (c) => {
  const version = await svc.update(c.req.param('id'), { status: 'ARCHIVED' });
  if (!version) return c.json({ error: 'Not found' }, 404);
  invalidateVersionCache(version.projectId);
  return c.json({ version });
});

// DELETE /versions/:id
// projectId query param is optional but enables immediate cache invalidation.
versionRoutes.delete('/:id', async (c) => {
  const projectId = c.req.query('projectId');
  await svc.delete(c.req.param('id'));
  if (projectId) invalidateVersionCache(projectId);
  return c.json({ ok: true });
});
