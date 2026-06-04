import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { TaskRepository } from './task.repository.js';
import { TaskService } from './task.service.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';
import { requireObjectAccess } from '../access/access.middleware.js';
import { cacheDelPattern } from '../../shared/lib/cache.js';
import { subLogger } from '../../shared/lib/logger.js';
import { pubsub } from '../../graphql/pubsub.js';
import { customFieldService } from '../customfields/customfield.service.js';
import { FieldValidationError, RequiredFieldsUnmetError } from '../customfields/customfield.errors.js';
import { taskTypeService } from '../tasktypes/tasktype.service.js';
import { tagService } from '../tags/tag.service.js';
import { watcherService } from '../watchers/watcher.service.js';
import { MultipleAssigneesDisabledError } from './task.errors.js';

const log = subLogger('tasks-routes');

// Tasks feed three server-cached read endpoints: /epics (5 min), /roadmap/*
// (2 min) and /sprints/* (2 min). Without this, a newly-created EPIC stays
// invisible on the Epics page (and Roadmap, sprint summaries) until the
// Redis TTL elapses, even though the Board is fresh because /tasks isn't
// server-cached. Scope the /epics bust to the project when known; /roadmap
// and /sprints don't share a single per-project URL pattern, so bust the
// whole resource family on any task write.
//
// Awaited so a read-after-write in the same client sees the new state.
async function invalidateTaskCaches(projectId?: string | null): Promise<void> {
  const epicsPattern = projectId
    ? `http:*:/api/v1/epics?projectId=${projectId}*`
    : 'http:*:/api/v1/epics?*';
  try {
    await Promise.all([
      cacheDelPattern(epicsPattern),
      cacheDelPattern('http:*:/api/v1/roadmap*'),
      cacheDelPattern('http:*:/api/v1/sprints*'),
    ]);
  } catch { /* ignore */ }
}

// ── Input schemas ───────────────────────────────────────────────────────────────────

const TASK_TYPES = ['EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK', 'IMPROVEMENT', 'FEATURE', 'TEST'] as const;
const PRIORITIES = ['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'] as const;

const createSchema = z.object({
  // Hierarchy (0029): projectId is now optional — when a listId is supplied the
  // SP derives the Space (bridge ProjectId). At least one must be present.
  projectId:   z.string().uuid().optional(),
  workspaceId: z.string().uuid(),
  title:       z.string().min(1).max(500),
  description: z.string().max(10_000).nullish(),
  type:        z.enum(TASK_TYPES).optional(),
  priority:    z.enum(PRIORITIES).optional(),
  sprintId:    z.string().uuid().nullish(),
  storyPoints: z.number().min(0).max(999).nullish(),
  dueDate:     z.string().datetime({ offset: true }).nullish(),
  listId:      z.string().uuid().nullish(),
  parentTaskId: z.string().uuid().nullish(),
}).refine((b) => b.projectId || b.listId, { message: 'Either projectId or listId is required' });

const moveSchema = z.object({
  listId:   z.string().uuid(),
  position: z.number().finite(),
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

// ── Custom-field values (Phase 2) ────────────────────────────────────────────
// usp_Task_GetById returns SELECT * (PascalCase); read both casings defensively.
const taskListId = (t: any): string | null => t?.listId ?? t?.ListId ?? null;
const taskProjectId = (t: any): string | null => t?.projectId ?? t?.ProjectId ?? null;

// GET /api/v1/tasks/:id/fields — effective fields + current values. VIEW on the task's list.
taskRoutes.get('/:id/fields',
  requireObjectAccess('VIEW', async (c) => {
    const lid = taskListId(await taskRepo.getById(c.req.param('id')!));
    return lid ? { type: 'LIST', id: lid } : null;
  }),
  async (c) => c.json({ data: await customFieldService.effectiveForTask(c.req.param('id')!) }));

// PUT /api/v1/tasks/:id/fields/:fieldId — set one value. EDIT on the task's list.
const setValueSchema = z.object({ value: z.unknown() });
taskRoutes.put('/:id/fields/:fieldId', zValidator('json', setValueSchema),
  requireObjectAccess('EDIT', async (c) => {
    const lid = taskListId(await taskRepo.getById(c.req.param('id')!));
    return lid ? { type: 'LIST', id: lid } : null;
  }),
  async (c) => {
    const taskId = c.req.param('id')!;
    try {
      await customFieldService.setValue(taskId, c.req.param('fieldId')!, c.req.valid('json').value);
      const fields = await customFieldService.effectiveForTask(taskId);
      const t = await taskRepo.getById(taskId);
      if (t) pubsub.publish('task:updated', { projectId: taskProjectId(t) as any, task: t });
      return c.json({ data: fields });
    } catch (err: any) {
      if (err instanceof FieldValidationError)
        return c.json({ error: { code: err.fieldCode, message: err.message } }, 422);
      if (err.number === 51303)
        return c.json({ error: { code: 'CUSTOM_FIELD_WORKSPACE_MISMATCH', message: err.message } }, 422);
      throw err;
    }
  });

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

    try {
      const task = await taskService.createTask(
        { ...body, reporterId: actorId },
        actorId
      );
      await invalidateTaskCaches(body.projectId);
      return c.json({ data: task }, 201);
    } catch (err: any) {
      // Hierarchy (0029) SP error mapping.
      if (err.number === 51230) return c.json({ error: { code: 'UNPROCESSABLE', message: err.message } }, 422);
      if (err.number === 51213) return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
      if (err.number === 51214) return c.json({ error: { code: 'BAD_REQUEST', message: err.message } }, 400);
      throw err;
    }
  },
);

// PATCH /api/v1/tasks/:id/move — re-home a task into a List (hierarchy Phase 1).
// Gated on EDIT access to the destination List.
taskRoutes.patch(
  '/:id/move',
  zValidator('json', moveSchema),
  requireObjectAccess('EDIT', (c) => ({ type: 'LIST', id: (c.req as any).valid('json').listId })),
  async (c) => {
    const id = c.req.param('id')!;
    const { listId, position } = c.req.valid('json');
    try {
      const task = await taskService.moveTask(id, listId, position);
      if (!task) return c.json({ error: { code: 'NOT_FOUND', message: 'Task not found' } }, 404);
      pubsub.publish('task:updated', { projectId: task.projectId, task });
      await invalidateTaskCaches(task.projectId);
      return c.json({ data: task });
    } catch (err: any) {
      if (err.number === 51213) return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
      if (err.number === 50404) return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
      log.error({ err: (err as Error).message }, 'moveTask failed');
      return c.json({ error: { message: 'Internal Server Error' } }, 500);
    }
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
      await invalidateTaskCaches();
      return c.json({ data: assignees });
    } catch (err: any) {
      if (err instanceof MultipleAssigneesDisabledError) {
        return c.json({ error: { code: 'MULTIPLE_ASSIGNEES_DISABLED', message: err.message } }, 422);
      }
      if (err.number === 51030) {
        return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
      }
      log.error({ err: (err as Error).message }, 'setAssignees failed');
      return c.json({ error: { message: 'Internal Server Error' } }, 500);
    }
  },
);

// ── Watchers (Phase 2) ───────────────────────────────────────────────────────
// GET /api/v1/tasks/:id/watchers — VIEW on the task's list (IDOR guard).
taskRoutes.get('/:id/watchers',
  requireObjectAccess('VIEW', async (c) => {
    const lid = taskListId(await taskRepo.getById(c.req.param('id')!));
    return lid ? { type: 'LIST', id: lid } : null;
  }),
  async (c) => c.json({ data: await watcherService.list(c.req.param('id')!) }));

// POST /api/v1/tasks/:id/watchers/:userId — add a watcher (idempotent)
taskRoutes.post(
  '/:id/watchers/:userId',
  requirePermission('task.update', { resolveWorkspace: resolveTaskWorkspace }),
  async (c) => {
    try {
      const w = await watcherService.add(c.req.param('id')!, c.req.param('userId')!);
      await invalidateTaskCaches();
      pubsub.publish('watcher:updated', { taskId: c.req.param('id')!, userId: c.req.param('userId')! });
      return c.json({ data: w });
    } catch (err: any) {
      if (err.number === 51360) return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
      if (err.number === 51361) return c.json({ error: { code: 'WATCHER_NOT_MEMBER', message: err.message } }, 422);
      throw err;
    }
  });

// DELETE /api/v1/tasks/:id/watchers/:userId — remove a watcher
taskRoutes.delete(
  '/:id/watchers/:userId',
  requirePermission('task.update', { resolveWorkspace: resolveTaskWorkspace }),
  async (c) => {
    await watcherService.remove(c.req.param('id')!, c.req.param('userId')!);
    await invalidateTaskCaches();
    pubsub.publish('watcher:updated', { taskId: c.req.param('id')!, userId: c.req.param('userId')! });
    return c.json({ data: { taskId: c.req.param('id'), userId: c.req.param('userId') } });
  });

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
      await invalidateTaskCaches(task.projectId);
      return c.json({ data: task });
    } catch (err: any) {
      log.error({ err: (err as Error).message }, 'setPosition failed');
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
    await invalidateTaskCaches(task.projectId);
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
    await invalidateTaskCaches(task.projectId);
    return c.json({ data: task });
  } catch (err: any) {
    if (err instanceof RequiredFieldsUnmetError) {
      return c.json({ error: { code: 'CUSTOM_FIELD_REQUIRED', message: err.message, missing: err.missing } }, 422);
    }
    if (err.number === 50003 || err.number === 50004) {
      return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
    }
    return c.json({ error: { message: 'Internal Server Error' } }, 500);
  }
});

// PATCH /api/v1/tasks/:id/type — set the task's custom task type (syncs legacy Type)
const setTypeSchema = z.object({ taskTypeId: z.string().uuid() });
taskRoutes.patch(
  '/:id/type',
  requirePermission('task.update', { resolveWorkspace: resolveTaskWorkspace }),
  zValidator('json', setTypeSchema),
  async (c) => {
    try {
      const task = await taskTypeService.setTaskType(c.req.param('id')!, c.req.valid('json').taskTypeId);
      if (!task) return c.json({ error: { code: 'NOT_FOUND', message: 'Task type not found' } }, 404);
      const projectId = ((task as any).ProjectId ?? (task as any).projectId ?? null) as string | null;
      await invalidateTaskCaches(projectId);
      pubsub.publish('task:updated', { projectId: projectId as any, task });
      return c.json({ data: task });
    } catch (err: any) {
      if (err.number === 51322 || err.number === 51323) {
        return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
      }
      throw err;
    }
  });

// GET /api/v1/tasks/:id/tags — tags linked to a task. VIEW on the task's list (IDOR guard).
taskRoutes.get('/:id/tags',
  requireObjectAccess('VIEW', async (c) => {
    const lid = taskListId(await taskRepo.getById(c.req.param('id')!));
    return lid ? { type: 'LIST', id: lid } : null;
  }),
  async (c) => c.json({ data: await tagService.listForTask(c.req.param('id')!) }));

// POST /api/v1/tasks/:id/tags/:tagId — link a tag (idempotent)
taskRoutes.post(
  '/:id/tags/:tagId',
  requirePermission('task.update', { resolveWorkspace: resolveTaskWorkspace }),
  async (c) => {
    try {
      await tagService.linkTask(c.req.param('id')!, c.req.param('tagId')!);
      await invalidateTaskCaches();
      return c.json({ data: { taskId: c.req.param('id'), tagId: c.req.param('tagId') } });
    } catch (err: any) {
      if (err.number === 51341 || err.number === 51342) {
        return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
      }
      if (err.number === 51343) {
        return c.json({ error: { code: 'TAG_WRONG_SPACE', message: err.message } }, 422);
      }
      throw err;
    }
  });

// DELETE /api/v1/tasks/:id/tags/:tagId — unlink a tag
taskRoutes.delete(
  '/:id/tags/:tagId',
  requirePermission('task.update', { resolveWorkspace: resolveTaskWorkspace }),
  async (c) => {
    await tagService.unlinkTask(c.req.param('id')!, c.req.param('tagId')!);
    await invalidateTaskCaches();
    return c.json({ data: { taskId: c.req.param('id'), tagId: c.req.param('tagId') } });
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
    await invalidateTaskCaches(task?.projectId);
    return c.json({ data: task });
  } catch (error: any) {
    if (error.number === 50004) {
      return c.json({ error: { message: error.message } }, 404);
    }
    return c.json({ error: { message: 'Internal Server Error' } }, 500);
  }
});
