import { Hono }       from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z }          from 'zod';
import { dashboardService } from './dashboard.service.js';
import { cardService } from './card.service.js';
import { DashboardRepository } from './dashboard.repository.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';
import { accessService } from '../access/access.service.js';
import { DashboardNotFoundError, DashboardValidationError } from './dashboard.errors.js';
import type { DashboardScopeType } from '@projectflow/types';

const repo = new DashboardRepository();
export const dashboardRoutes = new Hono();

// Read the authenticated user id — matches worklog.routes.ts's actual pattern.
function getUserId(c: any): string { return ((c as any).get('user') as any).userId as string; }

// ── RBAC resolvers ──────────────────────────────────────────────────────────
const resolveDashboardWorkspace = (c: any) => repo.getWorkspaceId(c.req.param('id'));

async function resolveScopeWorkspaceFromQuery(c: any): Promise<string | null> {
  try {
    const scopeType = c.req.query('scopeType');
    if (!scopeType) return null;
    const scope = await dashboardService.resolveScope(scopeType, c.req.query('scopeId') ?? null, c.req.query('workspaceId') ?? undefined);
    (c as any).set('resolvedScope', scope);
    return scope.workspaceId;
  } catch { return null; }
}

async function resolveScopeWorkspaceFromBody(c: any): Promise<string | null> {
  try {
    const b = await c.req.json();
    const scope = await dashboardService.resolveScope(b.scopeType, b.scopeId ?? null, b.workspaceId);
    (c as any).set('resolvedScope', scope);
    return scope.workspaceId;
  } catch { return null; }
}

async function resolveCardDashboardWorkspace(c: any): Promise<string | null> {
  const card = await repo.getCard(c.req.param('cardId'));
  if (!card) return null;
  (c as any).set('card', card);
  return repo.getWorkspaceId(card.dashboardId);
}

const layoutSchema = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() });
const createSchema = z.object({
  scopeType: z.enum(['workspace', 'space', 'folder', 'list']),
  scopeId:   z.string().uuid().nullable().optional(),
  name:      z.string().min(1).max(200),
  description: z.string().optional(),
  visibility: z.enum(['private', 'shared', 'protected']).optional(),
  workspaceId: z.string().uuid().optional(),
});
const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().nullable().optional(),
  visibility: z.enum(['private', 'shared', 'protected']).optional(),
  position: z.number().optional(),
});
const cardCreateSchema = z.object({
  type:   z.enum([
    'task_list', 'calculation', 'bar', 'line', 'pie', 'time_tracked', 'goal',          // wave-1 (9a)
    'burndown', 'velocity', 'burnup', 'cumulative_flow', 'lead_cycle_time',
    'sprint_summary', 'portfolio', 'timesheet', 'battery',                              // 9b
  ]),
  title:  z.string().max(200).nullable().optional(),
  config: z.record(z.string(), z.any()),
  layout: layoutSchema,
  position: z.number().optional(),
});
const cardUpdateSchema = z.object({
  title: z.string().max(200).nullable().optional(),
  config: z.record(z.string(), z.any()).optional(),
  layout: layoutSchema.optional(),
  position: z.number().optional(),
});
const reorderSchema = z.object({
  cards: z.array(z.object({ id: z.string().uuid(), layout: layoutSchema, position: z.number() })),
});

function fail(c: any, e: unknown) {
  if (e instanceof DashboardNotFoundError) return c.json({ error: e.message }, 404);
  if (e instanceof DashboardValidationError) return c.json({ error: e.message }, 400);
  return c.json({ error: (e as Error).message }, 500);
}

// Object-level VIEW gate for a node-scoped dashboard (no-op for workspace scope).
async function assertScopeView(c: any, userId: string, scopeType: DashboardScopeType, scopeId: string | null): Promise<boolean> {
  if (scopeType === 'workspace' || !scopeId) return true;
  const node = scopeType.toUpperCase() as 'SPACE' | 'FOLDER' | 'LIST';
  return accessService.can(userId, node, scopeId, 'VIEW');
}

// GET /dashboards?scopeType=&scopeId=&workspaceId=  (authorized: workspace RBAC + object-level VIEW)
dashboardRoutes.get('/',
  requirePermission('dashboard.read', { resolveWorkspace: resolveScopeWorkspaceFromQuery }),
  async (c) => {
    const userId = getUserId(c);
    const scopeType = c.req.query('scopeType') as DashboardScopeType | undefined;
    if (!scopeType) return c.json({ error: 'scopeType is required' }, 400);
    const scopeId = c.req.query('scopeId') ?? null;
    try {
      if (!(await assertScopeView(c, userId, scopeType, scopeId))) return c.json({ error: 'Forbidden' }, 403);
      const data = await dashboardService.list(userId, scopeType, scopeId, c.req.query('workspaceId') ?? undefined);
      return c.json({ data });
    } catch (e) { return fail(c, e); }
  });

// POST /dashboards
dashboardRoutes.post('/', zValidator('json', createSchema),
  requirePermission('dashboard.create', { resolveWorkspace: resolveScopeWorkspaceFromBody }),
  async (c) => {
    const userId = getUserId(c);
    const body = c.req.valid('json');
    try { return c.json({ data: await dashboardService.create(userId, body as any) }, 201); }
    catch (e) { return fail(c, e); }
  });

// GET /dashboards/:id  (with cards)
dashboardRoutes.get('/:id',
  requirePermission('dashboard.read', { resolveWorkspace: resolveDashboardWorkspace }),
  async (c) => {
    const userId = getUserId(c);
    try {
      const dash = await dashboardService.getWithCards(c.req.param('id')!);
      // Object-level VIEW gate on the dashboard's scope node (parity with the
      // GraphQL `dashboard(id)` resolver) so a workspace member lacking VIEW on a
      // scoped Space/Folder/List can't read its dashboards' metadata/card config.
      if (!(await assertScopeView(c, userId, dash.scopeType, dash.scopeId)))
        return c.json({ error: 'Forbidden' }, 403);
      return c.json({ data: dash });
    } catch (e) { return fail(c, e); }
  });

// PATCH /dashboards/:id
dashboardRoutes.patch('/:id',
  requirePermission('dashboard.update', { resolveWorkspace: resolveDashboardWorkspace }),
  zValidator('json', updateSchema),
  async (c) => {
    try { return c.json({ data: await dashboardService.update(c.req.param('id')!, c.req.valid('json')) }); }
    catch (e) { return fail(c, e); }
  });

// DELETE /dashboards/:id
dashboardRoutes.delete('/:id',
  requirePermission('dashboard.delete', { resolveWorkspace: resolveDashboardWorkspace }),
  async (c) => {
    try { return c.json({ data: await dashboardService.delete(c.req.param('id')!) }); }
    catch (e) { return fail(c, e); }
  });

// POST /dashboards/:id/set-default
dashboardRoutes.post('/:id/set-default',
  requirePermission('dashboard.update', { resolveWorkspace: resolveDashboardWorkspace }),
  async (c) => {
    try { return c.json({ data: await dashboardService.setDefault(c.req.param('id')!) }); }
    catch (e) { return fail(c, e); }
  });

// POST /dashboards/:id/cards
dashboardRoutes.post('/:id/cards',
  requirePermission('dashboard.update', { resolveWorkspace: resolveDashboardWorkspace }),
  zValidator('json', cardCreateSchema),
  async (c) => {
    try { return c.json({ data: await dashboardService.createCard(c.req.param('id')!, c.req.valid('json') as any) }, 201); }
    catch (e) { return fail(c, e); }
  });

// PUT /dashboards/:id/reorder-cards
dashboardRoutes.put('/:id/reorder-cards',
  requirePermission('dashboard.update', { resolveWorkspace: resolveDashboardWorkspace }),
  zValidator('json', reorderSchema),
  async (c) => {
    try { return c.json({ data: await dashboardService.reorderCards(c.req.param('id')!, c.req.valid('json').cards) }); }
    catch (e) { return fail(c, e); }
  });

// PATCH /cards/:cardId
dashboardRoutes.patch('/cards/:cardId',
  requirePermission('dashboard.update', { resolveWorkspace: resolveCardDashboardWorkspace }),
  zValidator('json', cardUpdateSchema),
  async (c) => {
    try { return c.json({ data: await dashboardService.updateCard(c.req.param('cardId')!, c.req.valid('json')) }); }
    catch (e) { return fail(c, e); }
  });

// DELETE /cards/:cardId
dashboardRoutes.delete('/cards/:cardId',
  requirePermission('dashboard.update', { resolveWorkspace: resolveCardDashboardWorkspace }),
  async (c) => {
    try { return c.json({ data: await dashboardService.deleteCard(c.req.param('cardId')!) }); }
    catch (e) { return fail(c, e); }
  });

// GET /cards/:cardId/data — resolve a card under the requesting user's object-level scope.
dashboardRoutes.get('/cards/:cardId/data',
  requirePermission('dashboard.read', { resolveWorkspace: resolveCardDashboardWorkspace }),
  async (c) => {
    const userId = getUserId(c);
    const card = (c as any).get('card');                    // cached by the RBAC resolver
    try {
      const dashboard = await dashboardService.getOrThrow(card.dashboardId);
      if (!(await assertScopeView(c, userId, dashboard.scopeType, dashboard.scopeId)))
        return c.json({ error: 'Forbidden' }, 403);
      return c.json({ data: await cardService.resolve(card, dashboard, userId) });
    } catch (e) { return fail(c, e); }
  });
