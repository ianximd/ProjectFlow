import { Hono }             from 'hono';
import { zValidator }       from '@hono/zod-validator';
import { z }                from 'zod';
import { AutomationService } from './automation.service.js';
import { AutomationRepository } from './automation.repository.js';
import { ProjectRepository } from '../projects/project.repository.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';
import { triggerSchema, conditionsSchema, actionSchema } from './automation.templates.schema.js';
import type { Variables }    from '../../server.js';

const svc = new AutomationService();

const automationRepoForLookup = new AutomationRepository();
const projectRepoForLookup    = new ProjectRepository();
const resolveAutomationWorkspace = (c: any) => automationRepoForLookup.getWorkspaceId(c.req.param('id'));

async function resolveCreateWorkspace(c: any): Promise<string | null> {
  try {
    const body = await c.req.json();
    if (body?.scopeType === 'WORKSPACE') return body?.workspaceId ?? null;
    return body?.projectId ? await projectRepoForLookup.getWorkspaceId(body.projectId) : null;
  } catch {
    return null;
  }
}

async function resolveListWorkspace(c: any): Promise<string | null> {
  const workspaceId = c.req.query('workspaceId');
  if (workspaceId) return workspaceId;
  const projectId = c.req.query('projectId');
  return projectId ? await projectRepoForLookup.getWorkspaceId(projectId) : null;
}

const createSchema = z.object({
  scopeType:   z.enum(['PROJECT', 'WORKSPACE']).default('PROJECT'),
  workspaceId: z.string().uuid(),
  projectId:   z.string().uuid().nullish(),
  name:        z.string().min(1).max(255),
  trigger:     triggerSchema,
  conditions:  conditionsSchema.default([]),
  actions:     z.array(actionSchema).min(1),
}).refine((v) => v.scopeType === 'WORKSPACE' || !!v.projectId, {
  message: 'projectId is required for PROJECT-scoped rules',
  path: ['projectId'],
});

const updateSchema = z.object({
  name:       z.string().min(1).max(255).optional(),
  isEnabled:  z.boolean().optional(),
  trigger:    triggerSchema.optional(),
  conditions: conditionsSchema.optional(),
  actions:    z.array(actionSchema).optional(),
});

export const automationRoutes = new Hono<{ Variables: Variables }>();

// GET /automations?projectId= OR ?workspaceId=
automationRoutes.get(
  '/',
  requirePermission('automation.read', { resolveWorkspace: resolveListWorkspace }),
  async (c) => {
    const projectId   = c.req.query('projectId');
    const workspaceId = c.req.query('workspaceId');
    if (!projectId && !workspaceId) return c.json({ error: 'projectId or workspaceId required' }, 400);
    const rules = await svc.list(projectId ?? workspaceId!);
    return c.json({ rules });
  },
);

// GET /automations/templates — localized in-code catalog (auth-only; static, no tenant data).
automationRoutes.get('/templates', async (c) => {
  const accept = c.req.header('accept-language') ?? '';
  const locale = accept.toLowerCase().startsWith('id') ? 'id' : 'en';
  return c.json({ templates: svc.listTemplates(locale) });
});

// GET /automations/usage?workspaceId= — read-only current-period run count (membership-gated).
automationRoutes.get(
  '/usage',
  requirePermission('automation.read', { resolveWorkspace: (c: any) => c.req.query('workspaceId') ?? null }),
  async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    const usage = await svc.getUsage(workspaceId);
    return c.json({ usage });
  },
);

// POST /automations
automationRoutes.post(
  '/',
  zValidator('json', createSchema),
  requirePermission('automation.create', { resolveWorkspace: resolveCreateWorkspace }),
  async (c) => {
    const { scopeType, workspaceId, projectId, name, trigger, conditions, actions } = c.req.valid('json');
    const rule = await svc.create(
      scopeType, workspaceId, scopeType === 'WORKSPACE' ? null : (projectId ?? null),
      name, trigger as any, conditions as any, actions as any,
    );
    return c.json({ rule }, 201);
  },
);

// PATCH /automations/:id
automationRoutes.patch(
  '/:id',
  requirePermission('automation.update', { resolveWorkspace: resolveAutomationWorkspace }),
  zValidator('json', updateSchema),
  async (c) => {
    const id   = c.req.param('id');
    const patch = c.req.valid('json');
    const rule  = await svc.update(id, patch as any);
    if (!rule) return c.json({ error: 'Not found' }, 404);
    return c.json({ rule });
  },
);

// POST /automations/:id/toggle  — enable / disable
automationRoutes.post(
  '/:id/toggle',
  requirePermission('automation.update', { resolveWorkspace: resolveAutomationWorkspace }),
  async (c) => {
  const id   = c.req.param('id')!;
  const body = await c.req.json<{ isEnabled: boolean }>();
  const rule  = await svc.update(id, { isEnabled: Boolean(body.isEnabled) });
  if (!rule) return c.json({ error: 'Not found' }, 404);
  return c.json({ rule });
});

// DELETE /automations/:id
automationRoutes.delete(
  '/:id',
  requirePermission('automation.delete', { resolveWorkspace: resolveAutomationWorkspace }),
  async (c) => {
  const id = c.req.param('id')!;
  await svc.delete(id);
  return c.json({ ok: true });
});

// GET /automations/:id/runs — run history
automationRoutes.get(
  '/:id/runs',
  requirePermission('automation.update', { resolveWorkspace: resolveAutomationWorkspace }),
  async (c) => {
    const id     = c.req.param('id')!;
    const limit  = Math.min(Number(c.req.query('limit')  ?? 50), 200);
    const offset = Math.max(Number(c.req.query('offset') ?? 0), 0);
    const runs   = await svc.listRuns(id, limit, offset);
    return c.json({ runs });
  },
);
