import { Hono }        from 'hono';
import { zValidator }  from '@hono/zod-validator';
import { z }           from 'zod';
import { LabelService } from './label.service.js';
import { cacheDelPattern } from '../../shared/lib/cache.js';

function invalidateLabelCache(projectId: string): void {
  // Pattern matches all user-scoped cached GET responses for this project's labels.
  // Key format: http:<userId>:/api/v1/labels?projectId=<projectId>...
  cacheDelPattern(`http:*:/api/v1/labels?projectId=${projectId}*`).catch(() => {});
}

const svc = new LabelService();

const createSchema = z.object({
  projectId: z.string().uuid(),
  name:      z.string().min(1).max(100),
  color:     z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#6c63ff'),
});

const updateSchema = z.object({
  name:  z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const labelRoutes = new Hono();

// GET /labels?projectId=
labelRoutes.get('/', async (c) => {
  const projectId = c.req.query('projectId');
  if (!projectId) return c.json({ error: 'projectId required' }, 400);
  const labels = await svc.list(projectId);
  return c.json({ labels });
});

// POST /labels
labelRoutes.post(
  '/',
  zValidator('json', createSchema),
  async (c) => {
    const { projectId, name, color } = c.req.valid('json');
    const label = await svc.create(projectId, name, color);
    invalidateLabelCache(projectId);
    return c.json({ label }, 201);
  },
);

// PATCH /labels/:id
labelRoutes.patch(
  '/:id',
  zValidator('json', updateSchema),
  async (c) => {
    const id    = c.req.param('id');
    const patch = c.req.valid('json');
    const label = await svc.update(id, patch);
    if (!label) return c.json({ error: 'Not found' }, 404);
    invalidateLabelCache(label.projectId);
    return c.json({ label });
  },
);

// DELETE /labels/:id
// projectId query param is optional but enables immediate cache invalidation.
labelRoutes.delete('/:id', async (c) => {
  const projectId = c.req.query('projectId');
  await svc.delete(c.req.param('id'));
  if (projectId) invalidateLabelCache(projectId);
  return c.json({ ok: true });
});
