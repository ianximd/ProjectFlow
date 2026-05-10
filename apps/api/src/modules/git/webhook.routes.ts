import { Hono } from 'hono';
import { GitRepository } from './git.repository.js';
import { GitService } from './git.service.js';

const gitRepo    = new GitRepository();
const gitService = new GitService(gitRepo);

export const webhookRoutes = new Hono();

// POST /webhooks/github  — called by GitHub
webhookRoutes.post('/github', async (c) => {
  const signature = c.req.header('X-Hub-Signature-256') ?? '';
  const event     = c.req.header('X-GitHub-Event') ?? '';
  const rawBody   = await c.req.text();

  const result = await gitService.processGitHubWebhook(rawBody, signature, event);
  if (!result.ok) {
    return c.json({ error: result.error }, 401);
  }
  return c.json({ ok: true });
});

// POST /webhooks/gitlab  — called by GitLab
webhookRoutes.post('/gitlab', async (c) => {
  const token   = c.req.header('X-Gitlab-Token') ?? '';
  const event   = c.req.header('X-Gitlab-Event') ?? '';

  let payload: any;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const result = await gitService.processGitLabWebhook(token, event, payload);
  if (!result.ok) {
    return c.json({ error: result.error }, 401);
  }
  return c.json({ ok: true });
});
