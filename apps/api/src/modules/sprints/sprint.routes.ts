import { Hono } from 'hono';
import { sprintService } from './sprint.service.js';
import { SprintRepository } from './sprint.repository.js';
import { ProjectRepository } from '../projects/project.repository.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';

export const sprintRoutes = new Hono();

// Workspace resolvers used by the RBAC middleware. Created once per module.
const sprintRepoForLookup  = new SprintRepository();
const projectRepoForLookup = new ProjectRepository();
const resolveSprintWorkspace = (c: any) => sprintRepoForLookup.getWorkspaceId(c.req.param('id'));

// POST /api/v1/sprints
sprintRoutes.post(
  '/',
  requirePermission('sprint.create', {
    // The body carries projectId; we look up its workspace via SP.
    resolveWorkspace: async (c) => {
      try {
        const body = await c.req.json();
        const projectId = body?.projectId;
        if (!projectId) return null;
        return await projectRepoForLookup.getWorkspaceId(projectId);
      } catch {
        return null;
      }
    },
  }),
  async (c) => {
    const { projectId, name, goal, startDate, endDate } = await c.req.json();
    if (!projectId || !name) return c.json({ error: { message: 'projectId and name are required' } }, 400);
    const sprint = await sprintService.create(
      projectId, name, goal ?? null,
      startDate ? new Date(startDate) : null,
      endDate ? new Date(endDate) : null
    );
    return c.json({ data: sprint }, 201);
  },
);

// GET /api/v1/sprints?projectId=
sprintRoutes.get('/', async (c) => {
  const projectId = c.req.query('projectId');
  if (!projectId) return c.json({ error: { message: 'projectId is required' } }, 400);
  const sprints = await sprintService.list(projectId);
  return c.json({ data: sprints });
});

// POST /api/v1/sprints/:id/start
sprintRoutes.post(
  '/:id/start',
  requirePermission('sprint.start', { resolveWorkspace: resolveSprintWorkspace }),
  async (c) => {
    try {
      const sprint = await sprintService.start(c.req.param('id')!);
      return c.json({ data: sprint });
    } catch (err: any) {
      if (err.number === 50030) return c.json({ error: { message: err.message } }, 409);
      return c.json({ error: { message: 'Internal Server Error' } }, 500);
    }
  },
);

// POST /api/v1/sprints/:id/complete
sprintRoutes.post(
  '/:id/complete',
  requirePermission('sprint.complete', { resolveWorkspace: resolveSprintWorkspace }),
  async (c) => {
    try {
      const sprint = await sprintService.complete(c.req.param('id')!);
      return c.json({ data: sprint });
    } catch (err: any) {
      if (err.number === 50031) return c.json({ error: { message: err.message } }, 409);
      return c.json({ error: { message: 'Internal Server Error' } }, 500);
    }
  },
);
