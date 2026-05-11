import { Hono } from 'hono';
import { WorkflowService } from './workflow.service.js';
import { WorkflowRepository } from './workflow.repository.js';
import { ProjectRepository } from '../projects/project.repository.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';

const svc = new WorkflowService();
export const workflowRoutes = new Hono();

const workflowRepoForLookup = new WorkflowRepository();
const projectRepoForLookup  = new ProjectRepository();
const resolveWorkflowWorkspace      = (c: any) => workflowRepoForLookup.getWorkspaceId(c.req.param('wfId'));
const resolveWorkflowStatusWorkspace = (c: any) => workflowRepoForLookup.getWorkspaceIdByStatus(c.req.param('statusId'));
async function resolveProjectWorkspaceFromBody(c: any): Promise<string | null> {
  try {
    const body = await c.req.json();
    return body?.projectId ? await projectRepoForLookup.getWorkspaceId(body.projectId) : null;
  } catch {
    return null;
  }
}

// GET /workflows?projectId=...
workflowRoutes.get('/', async (c) => {
  const projectId = c.req.query('projectId');
  if (!projectId) return c.json({ error: 'projectId is required' }, 400);

  try {
    const wf = await svc.getByProject(projectId);
    return c.json({ data: wf });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// POST /workflows  { projectId, name, template }
workflowRoutes.post(
  '/',
  requirePermission('workflow.update', { resolveWorkspace: resolveProjectWorkspaceFromBody }),
  async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { projectId, name, template } = body as {
    projectId: string;
    name: string;
    template?: string;
  };

  if (!projectId || !name) {
    return c.json({ error: 'projectId and name are required' }, 400);
  }

  try {
    const wf = await svc.create(projectId, name, template ?? 'DEFAULT');
    return c.json({ data: wf }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// POST /workflows/:wfId/statuses  { name, category, color }
workflowRoutes.post(
  '/:wfId/statuses',
  requirePermission('workflow.update', { resolveWorkspace: resolveWorkflowWorkspace }),
  async (c) => {
  const wfId = c.req.param('wfId')!;
  const body = await c.req.json().catch(() => ({}));
  const { name, category = 'TODO', color = '#6b7280' } = body as {
    name: string;
    category?: string;
    color?: string;
  };

  if (!name) return c.json({ error: 'name is required' }, 400);

  try {
    const status = await svc.addStatus(wfId, name, category, color);
    return c.json({ data: status }, 201);
  } catch (err: any) {
    const code = err.message?.includes('Violation of UNIQUE') ? 409 : 400;
    return c.json({ error: err.message }, code);
  }
});

// PATCH /workflows/statuses/:statusId  { name?, category?, color?, position? }
workflowRoutes.patch(
  '/statuses/:statusId',
  requirePermission('workflow.update', { resolveWorkspace: resolveWorkflowStatusWorkspace }),
  async (c) => {
  const statusId = c.req.param('statusId')!;
  const body     = await c.req.json().catch(() => ({}));
  const { name, category, color, position } = body as {
    name?: string;
    category?: string;
    color?: string;
    position?: number;
  };

  try {
    const status = await svc.updateStatus(statusId, name ?? null, category ?? null, color ?? null, position ?? null);
    return c.json({ data: status });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// DELETE /workflows/statuses/:statusId
workflowRoutes.delete(
  '/statuses/:statusId',
  requirePermission('workflow.update', { resolveWorkspace: resolveWorkflowStatusWorkspace }),
  async (c) => {
  const statusId = c.req.param('statusId')!;
  try {
    await svc.deleteStatus(statusId);
    return c.body(null, 204);
  } catch (err: any) {
    const code = err.message?.includes('Cannot delete') ? 409 : 400;
    return c.json({ error: err.message }, code);
  }
});

// POST /workflows/:wfId/transitions  { fromStatus, toStatus, name? }
workflowRoutes.post(
  '/:wfId/transitions',
  requirePermission('workflow.update', { resolveWorkspace: resolveWorkflowWorkspace }),
  async (c) => {
  const wfId = c.req.param('wfId')!;
  const body = await c.req.json().catch(() => ({}));
  const { fromStatus, toStatus, name } = body as {
    fromStatus: string;
    toStatus: string;
    name?: string;
  };

  if (!fromStatus || !toStatus) {
    return c.json({ error: 'fromStatus and toStatus are required' }, 400);
  }

  try {
    const t = await svc.addTransition(wfId, fromStatus, toStatus, name);
    return c.json({ data: t }, 201);
  } catch (err: any) {
    const code = err.message?.includes('not found') ? 404 : 400;
    return c.json({ error: err.message }, code);
  }
});

// DELETE /workflows/:wfId/transitions  { fromStatus, toStatus }
workflowRoutes.delete(
  '/:wfId/transitions',
  requirePermission('workflow.update', { resolveWorkspace: resolveWorkflowWorkspace }),
  async (c) => {
  const wfId = c.req.param('wfId')!;
  const body = await c.req.json().catch(() => ({}));
  const { fromStatus, toStatus } = body as { fromStatus: string; toStatus: string };

  if (!fromStatus || !toStatus) {
    return c.json({ error: 'fromStatus and toStatus are required' }, 400);
  }

  try {
    await svc.removeTransition(wfId, fromStatus, toStatus);
    return c.body(null, 204);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});
