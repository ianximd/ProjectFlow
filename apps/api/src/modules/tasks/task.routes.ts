import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { TaskRepository } from './task.repository.js';
import { TaskService } from './task.service.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';
import { cacheDelPattern } from '../../shared/lib/cache.js';

// Tasks feed three server-cached read endpoints: /epics (5 min), /roadmap/*
// (2 min) and /sprints/* (2 min). Without this, a newly-created EPIC stays
// invisible on the Epics page (and Roadmap, sprint summaries) until the
// Redis TTL elapses, even though the Board is fresh because /tasks isn't
// server-cached. Scope the /epics bust to the project when known; /roadmap
// and /sprints don't share a single per-project URL pattern, so bust the
// whole resource family on any task write.
function invalidateTaskCaches(projectId?: string | null): void {
  const epicsPattern = projectId
    ? `http:*:/api/v1/epics?projectId=${projectId}*`
    : 'http:*:/api/v1/epics?*';
  cacheDelPattern(epicsPattern).catch(() => {});
  cacheDelPattern('http:*:/api/v1/roadmap*').catch(() => {});
  cacheDelPattern('http:*:/api/v1/sprints*').catch(() => {});
}

// ── Input schemas ───────────────────────────────────────────────────────────────────

const TASK_TYPES = ['EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK', 'IMPROVEMENT', 'FEATURE', 'TEST'] as const;
const PRIORITIES = ['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'] as const;

const createSchema = z.object({
  projectId:   z.string().uuid(),
  workspaceId: z.string().uuid(),
  title:       z.string().min(1).max(500),
  description: z.string().max(10_000).nullish(),
  type:        z.enum(TASK_TYPES).optional(),
  priority:    z.enum(PRIORITIES).optional(),
  sprintId:    z.string().uuid().nullish(),
  storyPoints: z.number().min(0).max(999).nullish(),
  dueDate:     z.string().datetime({ offset: true }).nullish(),
});

const updateSchema = z.object({
  title:       z.string().min(1).max(500).optional(),
  description: z.string().max(10_000).nullish(),
  type:        z.enum(TASK_TYPES).optional(),
  priority:    z.enum(PRIORITIES).optional(),
  sprintId:    z.string().uuid().nullish(),
  epicId:      z.string().uuid().nullish(),
  storyPoints: z.number().min(0).max(999).nullish(),
  dueDate:     z.string().datetime({ offset: true }).nullish(),
});

const transitionSchema = z.object({
  status: z.string().min(1).max(100),
});

const assigneesSchema = z.object({
  userIds: z.array(z.string().uuid()).max(50),
});

const positionSchema = z.object({
  position: z.number().finite(),
  status:   z.string().min(1).max(100).optional(),
});

const taskRepo = new TaskRepository();
const taskService = new TaskService(taskRepo);

// Resolve the task's workspace from its id so resource-keyed routes can be
// permission-gated. Returns null when the task is missing/deleted, which the
// middleware translates into a 404.
const resolveTaskWorkspace = (c: any) => taskRepo.getWorkspaceId(c.req.param('id'));

export const taskRoutes = new Hono();

// GET /api/v1/tasks/:id
taskRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const task = await taskService.getTask(id);
  if (!task) return c.json({ error: { message: 'Task not found' } }, 404);
  return c.json({ data: task });
});

// POST /api/v1/tasks
taskRoutes.post(
  '/',
  zValidator('json', createSchema),
  requirePermission('task.create', {
    resolveWorkspace: async (c) => (c.req.valid('json' as never) as { workspaceId?: string })?.workspaceId ?? null,
  }),
  async (c) => {
    const body = c.req.valid('json');
    const user = (c as any).get('user') as any;
    const actorId = user.userId;

    const task = await taskService.createTask(
      { ...body, reporterId: actorId },
      actorId
    );
    invalidateTaskCaches(body.projectId);
    return c.json({ data: task }, 201);
  },
);

// GET /api/v1/tasks
taskRoutes.get('/', async (c) => {
  const projectId = c.req.query('projectId');
  if (!projectId) return c.json({ error: { message: 'projectId is required' } }, 400);

  const filters = {
    projectId,
    status: c.req.query('status'),
    assigneeId: c.req.query('assigneeId'),
  };

  const result = await taskService.listTasks(filters);
  return c.json({
    data: result.tasks,
    meta: { total: result.total, assigneesByTaskId: result.assigneesByTaskId },
  });
});

// PUT /api/v1/tasks/:id/assignees — replace the full assignee set.
// Empty array clears all assignees. SP filters out non-workspace members.
taskRoutes.put(
  '/:id/assignees',
  requirePermission('task.assign', { resolveWorkspace: resolveTaskWorkspace }),
  zValidator('json', assigneesSchema),
  async (c) => {
    const id = c.req.param('id')!;
    const { userIds } = c.req.valid('json');
    const user = (c as any).get('user') as any;
    try {
      const assignees = await taskService.setAssignees(id, userIds, user.userId);
      invalidateTaskCaches();
      return c.json({ data: assignees });
    } catch (err: any) {
      if (err.number === 51030) {
        return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
      }
      console.error('[taskRoutes] setAssignees failed:', err);
      return c.json({ error: { message: 'Internal Server Error' } }, 500);
    }
  },
);

// PATCH /api/v1/tasks/:id/position — drag-end persistence. Optional status
// is set when a card is dropped into a different column so the board can
// commit the cross-column move in a single round-trip.
taskRoutes.patch(
  '/:id/position',
  requirePermission('task.update', { resolveWorkspace: resolveTaskWorkspace }),
  zValidator('json', positionSchema),
  async (c) => {
    const id = c.req.param('id')!;
    const { position, status } = c.req.valid('json');
    try {
      const task = await taskService.setPosition(id, position, status ?? null);
      if (!task) return c.json({ error: { code: 'NOT_FOUND', message: 'Task not found' } }, 404);
      invalidateTaskCaches(task.projectId);
      return c.json({ data: task });
    } catch (err: any) {
      console.error('[taskRoutes] setPosition failed:', err);
      return c.json({ error: { message: 'Internal Server Error' } }, 500);
    }
  },
);

// PATCH /api/v1/tasks/:id  (full field update — must be before /:id/transition)
taskRoutes.patch(
  '/:id',
  requirePermission('task.update', { resolveWorkspace: resolveTaskWorkspace }),
  zValidator('json', updateSchema),
  async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const user = (c as any).get('user') as any;
  const actorId = user.userId;

  try {
    const task = await taskService.updateTask(id, body, actorId);
    if (!task) return c.json({ error: { code: 'NOT_FOUND', message: 'Task not found' } }, 404);
    invalidateTaskCaches(task.projectId);
    return c.json({ data: task });
  } catch (err: any) {
    if (err.number === 50003 || err.number === 50004) {
      return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
    }
    return c.json({ error: { message: 'Internal Server Error' } }, 500);
  }
});

// PATCH /api/v1/tasks/:id/transition
taskRoutes.patch(
  '/:id/transition',
  requirePermission('task.transition', { resolveWorkspace: resolveTaskWorkspace }),
  zValidator('json', transitionSchema),
  async (c) => {
  const id = c.req.param('id');
  const { status } = c.req.valid('json');
  const user = (c as any).get('user') as any;
  const actorId = user.userId;

  try {
    const task = await taskService.transitionTask(id, status, actorId);
    if (!task) return c.json({ error: { code: 'NOT_FOUND', message: 'Task not found' } }, 404);
    invalidateTaskCaches(task.projectId);
    return c.json({ data: task });
  } catch (err: any) {
    if (err.number === 50003 || err.number === 50004) {
      return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
    }
    return c.json({ error: { message: 'Internal Server Error' } }, 500);
  }
});

// DELETE /api/v1/tasks/:id
taskRoutes.delete(
  '/:id',
  requirePermission('task.delete', { resolveWorkspace: resolveTaskWorkspace }),
  async (c) => {
  const id = c.req.param('id')!;
  const user = (c as any).get('user') as any;
  const actorId = user.userId;
  
  try {
    const task = await taskService.deleteTask(id, actorId);
    invalidateTaskCaches(task?.projectId);
    return c.json({ data: task });
  } catch (error: any) {
    if (error.number === 50004) {
      return c.json({ error: { message: error.message } }, 404);
    }
    return c.json({ error: { message: 'Internal Server Error' } }, 500);
  }
});
