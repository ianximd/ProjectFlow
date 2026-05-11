import { Hono }        from 'hono';
import { zValidator }  from '@hono/zod-validator';
import { z }           from 'zod';
import { ComponentService } from './component.service.js';
import { ComponentRepository } from './component.repository.js';
import { ProjectRepository } from '../projects/project.repository.js';
import { cacheDelPattern } from '../../shared/lib/cache.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';

const componentRepoForLookup = new ComponentRepository();
const projectRepoForLookup   = new ProjectRepository();
const resolveComponentWorkspace = (c: any) => componentRepoForLookup.getWorkspaceId(c.req.param('id'));
async function resolveProjectWorkspaceFromBody(c: any): Promise<string | null> {
  try {
    const body = await c.req.json();
    return body?.projectId ? await projectRepoForLookup.getWorkspaceId(body.projectId) : null;
  } catch {
    return null;
  }
}

function invalidateComponentCache(projectId: string): void {
  cacheDelPattern(`http:*:/api/v1/components?projectId=${projectId}*`).catch(() => {});
}

const svc = new ComponentService();

const createSchema = z.object({
  projectId:   z.string().uuid(),
  name:        z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  leadUserId:  z.string().uuid().optional().nullable(),
});

const updateSchema = z.object({
  name:        z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  leadUserId:  z.string().uuid().optional().nullable(),
});

export const componentRoutes = new Hono();

// GET /components?projectId=
componentRoutes.get('/', async (c) => {
  const projectId = c.req.query('projectId');
  if (!projectId) return c.json({ error: 'projectId required' }, 400);
  const components = await svc.list(projectId);
  return c.json({ components });
});

// POST /components
componentRoutes.post(
  '/',
  zValidator('json', createSchema),
  requirePermission('component.manage', { resolveWorkspace: resolveProjectWorkspaceFromBody }),
  async (c) => {
    const { projectId, name, description, leadUserId } = c.req.valid('json');
    const component = await svc.create(
      projectId, name,
      description ?? null,
      leadUserId  ?? null,
    );
    invalidateComponentCache(projectId);
    return c.json({ component }, 201);
  },
);

// PATCH /components/:id
componentRoutes.patch(
  '/:id',
  requirePermission('component.manage', { resolveWorkspace: resolveComponentWorkspace }),
  zValidator('json', updateSchema),
  async (c) => {
    const id        = c.req.param('id');
    const patch     = c.req.valid('json');
    const component = await svc.update(id, patch);
    if (!component) return c.json({ error: 'Not found' }, 404);
    invalidateComponentCache(component.projectId);
    return c.json({ component });
  },
);

// DELETE /components/:id
// projectId query param is optional but enables immediate cache invalidation.
componentRoutes.delete(
  '/:id',
  requirePermission('component.manage', { resolveWorkspace: resolveComponentWorkspace }),
  async (c) => {
  const projectId = c.req.query('projectId');
  await svc.delete(c.req.param('id')!);
  if (projectId) invalidateComponentCache(projectId);
  return c.json({ ok: true });
});
