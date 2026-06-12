import { Hono } from 'hono';
import { sprintService } from './sprint.service.js';
import { SprintRepository } from './sprint.repository.js';
import { ProjectRepository } from '../projects/project.repository.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';
import { runSprintSweep } from './sprint.worker.js';

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

// ── Sprint-folder hierarchy (Phase 8c) ───────────────────────────────────────
const resolveFolderWorkspace = (c: any) => sprintRepoForLookup.getFolderWorkspaceId(c.req.param('folderId'));

// PUT /api/v1/sprints/folders/:folderId/settings
sprintRoutes.put(
  '/folders/:folderId/settings',
  requirePermission('sprint.manage', { resolveWorkspace: resolveFolderWorkspace }),
  async (c) => {
    const folderId = c.req.param('folderId')!;
    const b = await c.req.json();
    if (typeof b?.durationDays !== 'number' || b.durationDays <= 0)
      return c.json({ error: { message: 'durationDays must be a positive integer' } }, 400);
    const settings = await sprintService.setSettings(folderId, {
      durationDays:    b.durationDays,
      startDayOfWeek:  b.startDayOfWeek ?? null,
      autoStart:       !!b.autoStart,
      autoComplete:    !!b.autoComplete,
      autoRollForward: !!b.autoRollForward,
      pointsFieldId:   b.pointsFieldId ?? null,
    });
    return c.json({ data: settings });
  },
);

// GET /api/v1/sprints/folders/:folderId/settings
sprintRoutes.get(
  '/folders/:folderId/settings',
  requirePermission('sprint.manage', { resolveWorkspace: resolveFolderWorkspace }),
  async (c) => c.json({ data: await sprintService.getSettings(c.req.param('folderId')!) }),
);

// POST /api/v1/sprints/folders/:folderId/sprints
sprintRoutes.post(
  '/folders/:folderId/sprints',
  requirePermission('sprint.create', { resolveWorkspace: resolveFolderWorkspace }),
  async (c) => {
    const folderId = c.req.param('folderId')!;
    const { name, goal, startDate, endDate } = await c.req.json();
    if (!name) return c.json({ error: { message: 'name is required' } }, 400);
    try {
      const sprint = await sprintService.createInFolder(
        folderId, name, goal ?? null,
        startDate ? new Date(startDate) : null,
        endDate ? new Date(endDate) : null,
      );
      return c.json({ data: sprint }, 201);
    } catch (err: any) {
      if (err.number === 50046) return c.json({ error: { message: err.message } }, 422);
      return c.json({ error: { message: 'Internal Server Error' } }, 500);
    }
  },
);

// GET /api/v1/sprints/:id/points
sprintRoutes.get(
  '/:id/points',
  requirePermission('sprint.start', { resolveWorkspace: resolveSprintWorkspace }),
  async (c) => c.json({ data: await sprintService.getPoints(c.req.param('id')!) }),
);

// POST /api/v1/sprints/:id/roll-forward
sprintRoutes.post(
  '/:id/roll-forward',
  requirePermission('sprint.manage', { resolveWorkspace: resolveSprintWorkspace }),
  async (c) => {
    const { toSprintId } = await c.req.json();
    if (!toSprintId) return c.json({ error: { message: 'toSprintId is required' } }, 400);
    try {
      const rolled = await sprintService.rollForward(c.req.param('id')!, toSprintId);
      return c.json({ data: { rolled } });
    } catch (err: any) {
      // 50047 target sprint has no List; 50048 source sprint missing/no List.
      if (err.number === 50047 || err.number === 50048) return c.json({ error: { message: err.message } }, 422);
      return c.json({ error: { message: 'Internal Server Error' } }, 500);
    }
  },
);

// Test/dev-only manual sweep trigger (NEVER mounted in production). Lets e2e
// drive the scheduler deterministically without waiting for the 15-min tick.
if (process.env.NODE_ENV !== 'production') {
  sprintRoutes.post('/_sweep', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const now = body?.now ? new Date(body.now) : new Date();
    const result = await runSprintSweep(now);
    return c.json({ data: result });
  });
}
