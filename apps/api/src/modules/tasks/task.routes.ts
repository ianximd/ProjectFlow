import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { TaskRepository } from './task.repository.js';
import { TaskService } from './task.service.js';

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

const taskRepo = new TaskRepository();
const taskService = new TaskService(taskRepo);

export const taskRoutes = new Hono();

// GET /api/v1/tasks/:id
taskRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const task = await taskService.getTask(id);
  if (!task) return c.json({ error: { message: 'Task not found' } }, 404);
  return c.json({ data: task });
});

// POST /api/v1/tasks
taskRoutes.post('/', zValidator('json', createSchema), async (c) => {
  const body = c.req.valid('json');
  const user = (c as any).get('user') as any;
  const actorId = user.userId;

  const task = await taskService.createTask(
    { ...body, reporterId: actorId },
    actorId
  );
  return c.json({ data: task }, 201);
});

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
  return c.json({ data: result.tasks, meta: { total: result.total } });
});

// PATCH /api/v1/tasks/:id  (full field update — must be before /:id/transition)
taskRoutes.patch('/:id', zValidator('json', updateSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const user = (c as any).get('user') as any;
  const actorId = user.userId;

  try {
    const task = await taskService.updateTask(id, body, actorId);
    if (!task) return c.json({ error: { code: 'NOT_FOUND', message: 'Task not found' } }, 404);
    return c.json({ data: task });
  } catch (err: any) {
    if (err.number === 50003 || err.number === 50004) {
      return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
    }
    return c.json({ error: { message: 'Internal Server Error' } }, 500);
  }
});

// PATCH /api/v1/tasks/:id/transition
taskRoutes.patch('/:id/transition', zValidator('json', transitionSchema), async (c) => {
  const id = c.req.param('id');
  const { status } = c.req.valid('json');
  const user = (c as any).get('user') as any;
  const actorId = user.userId;

  try {
    const task = await taskService.transitionTask(id, status, actorId);
    if (!task) return c.json({ error: { code: 'NOT_FOUND', message: 'Task not found' } }, 404);
    return c.json({ data: task });
  } catch (err: any) {
    if (err.number === 50003 || err.number === 50004) {
      return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
    }
    return c.json({ error: { message: 'Internal Server Error' } }, 500);
  }
});

// DELETE /api/v1/tasks/:id
taskRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const user = (c as any).get('user') as any;
  const actorId = user.userId;
  
  try {
    const task = await taskService.deleteTask(id, actorId);
    return c.json({ data: task });
  } catch (error: any) {
    if (error.number === 50004) {
      return c.json({ error: { message: error.message } }, 404);
    }
    return c.json({ error: { message: 'Internal Server Error' } }, 500);
  }
});
