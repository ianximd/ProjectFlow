import { Hono } from 'hono';
import { EpicRepository } from './epic.repository.js';

const repo = new EpicRepository();

export const epicRoutes = new Hono();

// GET /epics?projectId=
epicRoutes.get('/', async (c) => {
  const projectId = c.req.query('projectId');
  if (!projectId) return c.json({ error: 'projectId required' }, 400);
  const epics = await repo.list(projectId);
  return c.json({ epics });
});
