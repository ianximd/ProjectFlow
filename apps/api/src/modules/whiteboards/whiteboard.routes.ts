import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { WhiteboardService } from './whiteboard.service.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';
import { requireObjectAccess } from '../access/access.middleware.js';
import type { HierarchyNodeType } from '@projectflow/types';

const svc = new WhiteboardService();

async function resolveWhiteboardScope(c: any): Promise<{ type: HierarchyNodeType; id: string } | null> {
  const wb = await svc.getById(c.req.param('id')!);
  return wb ? { type: wb.scopeType as HierarchyNodeType, id: wb.scopeId } : null;
}
const resolveWhiteboardWorkspace = (c: any) => svc.getWorkspaceId(c.req.param('id')!);

const createSchema = z.object({
  workspaceId: z.string().uuid(),
  scopeType:   z.enum(['SPACE', 'FOLDER', 'LIST']),
  scopeId:     z.string().uuid(),
  name:        z.string().min(1).max(255),
});
const updateSchema = z.object({ name: z.string().min(1).max(255).optional() });
const convertSchema = z.object({
  targetListId: z.string().uuid(),
  shapeId:      z.string().min(1).max(100),
  shape: z.object({
    id:    z.string().min(1).max(100),
    type:  z.string().min(1).max(50),
    props: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const whiteboardRoutes = new Hono();

// GET /whiteboards?workspaceId=&scopeType=&scopeId=  — list in a scope. VIEW on scope.
whiteboardRoutes.get(
  '/',
  requireObjectAccess('VIEW', (c) => {
    const scopeType = c.req.query('scopeType') as HierarchyNodeType | undefined;
    const scopeId   = c.req.query('scopeId');
    return scopeType && scopeId ? { type: scopeType, id: scopeId } : null;
  }),
  async (c) => {
    const scopeType = c.req.query('scopeType') as any;
    const scopeId   = c.req.query('scopeId')!;
    const wsId      = c.req.query('workspaceId')!;
    const list = await svc.listForScope(wsId, scopeType, scopeId);
    return c.json({ data: list });
  },
);

// POST /whiteboards — create. Validator first, then EDIT gate (gate reads c.req.valid('json')).
whiteboardRoutes.post(
  '/',
  zValidator('json', createSchema),
  requireObjectAccess('EDIT', (c) => {
    const b = (c.req as any).valid('json');
    return { type: b.scopeType as HierarchyNodeType, id: b.scopeId };
  }),
  async (c) => {
    const b = c.req.valid('json');
    const user = (c as any).get('user') as any;
    const userId = user.userId;

    // I1 guard: re-derive the workspace from the scope node — never trust the
    // caller-supplied workspaceId for the stored value.
    // Delegates to svc.getScopeWorkspaceId (lifted from the local helper for DRY
    // sharing with the GraphQL create path).
    const resolvedWorkspaceId = await svc.getScopeWorkspaceId(b.scopeType, b.scopeId);
    if (!resolvedWorkspaceId) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Scope not found' } }, 404);
    }
    if (b.workspaceId !== resolvedWorkspaceId) {
      return c.json({ error: { code: 'WORKSPACE_MISMATCH', message: 'workspaceId does not match scope' } }, 400);
    }

    const wb = await svc.create({ ...b, workspaceId: resolvedWorkspaceId, createdById: userId });
    return c.json({ data: wb }, 201);
  },
);

// GET /whiteboards/:id — VIEW on scope.
whiteboardRoutes.get('/:id', requireObjectAccess('VIEW', resolveWhiteboardScope), async (c) => {
  const wb = await svc.getById(c.req.param('id')!);
  if (!wb) return c.json({ error: { code: 'NOT_FOUND', message: 'Whiteboard not found' } }, 404);
  return c.json({ data: wb });
});

// GET /whiteboards/:id/links — VIEW on scope.
whiteboardRoutes.get('/:id/links', requireObjectAccess('VIEW', resolveWhiteboardScope),
  async (c) => c.json({ data: await svc.listTaskLinks(c.req.param('id')!) }));

// PATCH /whiteboards/:id — rename. EDIT on scope.
whiteboardRoutes.patch('/:id', requireObjectAccess('EDIT', resolveWhiteboardScope), zValidator('json', updateSchema),
  async (c) => {
    const wb = await svc.update(c.req.param('id')!, c.req.valid('json').name);
    if (!wb) return c.json({ error: { code: 'NOT_FOUND', message: 'Whiteboard not found' } }, 404);
    return c.json({ data: wb });
  });

// DELETE /whiteboards/:id — soft-delete. EDIT on scope.
whiteboardRoutes.delete('/:id', requireObjectAccess('EDIT', resolveWhiteboardScope), async (c) => {
  const wb = await svc.softDelete(c.req.param('id')!);
  if (!wb) return c.json({ error: { code: 'NOT_FOUND', message: 'Whiteboard not found' } }, 404);
  return c.json({ data: wb });
});

// POST /whiteboards/:id/convert-to-task — mint a task in the target List from a shape.
// Gate order: VIEW on board scope → workspace RBAC task.create → validate body → EDIT on dest List.
// The zValidator MUST come before the EDIT gate so c.req.valid('json') is populated when the gate runs.
whiteboardRoutes.post(
  '/:id/convert-to-task',
  requireObjectAccess('VIEW', resolveWhiteboardScope),
  requirePermission('task.create', { resolveWorkspace: resolveWhiteboardWorkspace }),
  zValidator('json', convertSchema),
  requireObjectAccess('EDIT', (c) => {
    const b = (c.req as any).valid('json');
    return b?.targetListId ? { type: 'LIST' as HierarchyNodeType, id: b.targetListId } : null;
  }),
  async (c) => {
    const id = c.req.param('id')!;
    const user = (c as any).get('user') as any;
    const userId = user.userId;
    // Board-existence check (keeps the 404 guard; workspaceId used only for the
    // task.create RBAC gate above — NOT passed into convertShapeToTask).
    const boardWorkspaceId = await svc.getWorkspaceId(id);
    if (!boardWorkspaceId) return c.json({ error: { code: 'NOT_FOUND', message: 'Whiteboard not found' } }, 404);
    const { targetListId, shape } = c.req.valid('json');
    try {
      const result = await svc.convertShapeToTask(id, targetListId, shape, userId);
      return c.json({ data: result }, 201);
    } catch (err: any) {
      if ((err as any)?.statusCode === 404) return c.json({ error: { code: 'NOT_FOUND', message: 'List not found' } }, 404);
      if (err.number === 51230) return c.json({ error: { code: 'UNPROCESSABLE', message: err.message } }, 422);
      if (err.number === 51213) return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
      if (err.number === 51214) return c.json({ error: { code: 'BAD_REQUEST', message: err.message } }, 400);
      throw err;
    }
  },
);
