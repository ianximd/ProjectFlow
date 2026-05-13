import { Hono } from 'hono';
import { projectService } from './project.service.js';
import { ProjectRepository } from './project.repository.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';
import { cacheDelPattern } from '../../shared/lib/cache.js';

// /projects/* is server-cached for 30s (TTL.SHORT). Wildcard-bust on any
// project write so the projects list under a workspace updates immediately
// instead of waiting for the TTL to expire.
//
// Awaited so a read-after-write in the same client sees the new state.
async function invalidateProjectCaches(): Promise<void> {
  try { await cacheDelPattern('http:*:/api/v1/projects*'); } catch { /* ignore */ }
}

export const projectRoutes = new Hono();

// Workspace resolvers used by the RBAC middleware. Created once per module.
const projectRepoForLookup = new ProjectRepository();
const resolveProjectWorkspace = (c: any) => projectRepoForLookup.getWorkspaceId(c.req.param('id'));

// POST /api/v1/projects
projectRoutes.post(
  '/',
  requirePermission('project.create', {
    // workspaceId comes from the JSON body — read it once and reuse.
    resolveWorkspace: async (c) => {
      try {
        const body = await c.req.json();
        return body?.workspaceId ?? null;
      } catch {
        return null;
      }
    },
  }),
  async (c) => {
    const { workspaceId, name, key, description, type } = await c.req.json();
    if (!workspaceId || !name || !key) return c.json({ error: { message: 'workspaceId, name, and key are required' } }, 400);
    const user = (c as any).get('user') as any;
    try {
      const project = await projectService.create(workspaceId, name, key, description ?? null, type ?? 'KANBAN', user.userId);
      await invalidateProjectCaches();
      return c.json({ data: project }, 201);
    } catch (err: any) {
      if (err.number === 50020) return c.json({ error: { message: err.message } }, 409);
      return c.json({ error: { message: 'Internal Server Error' } }, 500);
    }
  },
);

// GET /api/v1/projects?workspaceId=
projectRoutes.get('/', async (c) => {
  const workspaceId = c.req.query('workspaceId');
  if (!workspaceId) return c.json({ error: { message: 'workspaceId is required' } }, 400);
  const projects = await projectService.list(workspaceId);
  return c.json({ data: projects });
});

// GET /api/v1/projects/:id
projectRoutes.get('/:id', async (c) => {
  const project = await projectService.getById(c.req.param('id'));
  if (!project) return c.json({ error: { message: 'Project not found' } }, 404);
  return c.json({ data: project });
});

// PATCH /api/v1/projects/:id
projectRoutes.patch(
  '/:id',
  requirePermission('project.update', { resolveWorkspace: resolveProjectWorkspace }),
  async (c) => {
  const { name, description, avatarUrl, type, startDate, endDate } = await c.req.json();
  try {
    const project = await projectService.update(c.req.param('id')!, {
      name,
      description,
      avatarUrl,
      type,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
    if (!project) return c.json({ error: { message: 'Project not found' } }, 404);
    await invalidateProjectCaches();
    return c.json({ data: project });
  } catch (err: any) {
    return c.json({ error: { message: 'Internal Server Error' } }, 500);
  }
});

// POST /api/v1/projects/:id/archive
projectRoutes.post(
  '/:id/archive',
  requirePermission('project.update', { resolveWorkspace: resolveProjectWorkspace }),
  async (c) => {
  try {
    const project = await projectService.archive(c.req.param('id')!);
    if (!project) return c.json({ error: { message: 'Project not found' } }, 404);
    await invalidateProjectCaches();
    return c.json({ data: project });
  } catch (err: any) {
    return c.json({ error: { message: 'Internal Server Error' } }, 500);
  }
});

// DELETE /api/v1/projects/:id
projectRoutes.delete(
  '/:id',
  requirePermission('project.delete', { resolveWorkspace: resolveProjectWorkspace }),
  async (c) => {
  try {
    await projectService.delete(c.req.param('id')!);
    await invalidateProjectCaches();
    return c.body(null, 204);
  } catch (err: any) {
    return c.json({ error: { message: 'Internal Server Error' } }, 500);
  }
});
