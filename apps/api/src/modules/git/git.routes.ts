import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { GitRepository } from './git.repository.js';
import { GitService } from './git.service.js';

const gitRepo    = new GitRepository();
const gitService = new GitService(gitRepo);

export const gitRoutes = new Hono();

const createSchema = z.object({
  workspaceId:   z.string().uuid(),
  provider:      z.enum(['github', 'gitlab']),
  repoOwner:     z.string().min(1).max(255),
  repoName:      z.string().min(1).max(255),
  webhookSecret: z.string().min(8).max(500),
  webhookId:     z.string().max(100).optional(),
});

// GET /git/connections?workspaceId=
gitRoutes.get('/connections', async (c) => {
  const workspaceId = c.req.query('workspaceId');
  if (!workspaceId) return c.json({ error: { message: 'workspaceId is required' } }, 400);
  const connections = await gitService.listConnections(workspaceId);
  return c.json({ connections });
});

// POST /git/connections
gitRoutes.post('/connections', zValidator('json', createSchema), async (c) => {
  const body = c.req.valid('json');
  const connection = await gitService.createConnection(
    body.workspaceId, body.provider, body.repoOwner, body.repoName,
    body.webhookSecret, body.webhookId ?? null,
  );
  return c.json({ connection }, 201);
});

// DELETE /git/connections/:id
gitRoutes.delete('/connections/:id', async (c) => {
  const id = c.req.param('id');
  await gitService.deleteConnection(id);
  return c.json({ ok: true });
});

// GET /git/pull-requests?taskId=
gitRoutes.get('/pull-requests', async (c) => {
  const taskId = c.req.query('taskId');
  if (!taskId) return c.json({ error: { message: 'taskId is required' } }, 400);
  const pullRequests = await gitService.listPRsByTask(taskId);
  return c.json({ pullRequests });
});

// GET /git/commits?taskId=
gitRoutes.get('/commits', async (c) => {
  const taskId = c.req.query('taskId');
  if (!taskId) return c.json({ error: { message: 'taskId is required' } }, 400);
  const commits = await gitService.listCommitsByTask(taskId);
  return c.json({ commits });
});
