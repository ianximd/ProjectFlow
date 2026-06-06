import { Hono } from 'hono';
import type { Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { templateService, TemplateSourceNotFoundError } from './template.service.js';
import { requireObjectAccess } from '../access/access.middleware.js';
import { roleService } from '../roles/role.service.js';
import { isWorkspaceMember } from '../workspaces/membership.js';
import type { TemplateScopeType } from '@projectflow/types';

export const templateRoutes = new Hono();

const SCOPE = z.enum(['TASK', 'LIST', 'FOLDER', 'SPACE']);

function getUserId(c: Context): string | null {
  return (c as any).get('user')?.userId ?? null;
}

const createSchema = z.object({
  scopeType: SCOPE,
  sourceId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(4000).optional(),
});

// ── POST /templates ──
// Capture: VIEW on the source node. SPACE/FOLDER/LIST resolve directly; TASK
// resolves to VIEW on the task's own List (mirrors the recurrence/task routes).
templateRoutes.post(
  '/',
  zValidator('json', createSchema),
  requireObjectAccess('VIEW', async (c) => {
    const b = (c.req as any).valid('json') as { scopeType: TemplateScopeType; sourceId: string };
    if (b.scopeType === 'TASK') {
      const listId = await templateService.taskListId(b.sourceId);
      return listId ? { type: 'LIST' as const, id: listId } : null;
    }
    return { type: b.scopeType as 'SPACE' | 'FOLDER' | 'LIST', id: b.sourceId };
  }),
  async (c) => {
    const userId = getUserId(c)!;
    const b = c.req.valid('json');
    try {
      const tpl = await templateService.captureTemplate(
        b.scopeType, b.sourceId, b.name, b.description ?? null, userId,
      );
      return c.json({ data: tpl }, 201);
    } catch (err) {
      if (err instanceof TemplateSourceNotFoundError)
        return c.json({ error: { code: err.code, message: err.message } }, 404);
      throw err;
    }
  },
);

// ── GET /templates?scopeType= ──
// Workspace-membership gated. workspaceId is required (templates are
// workspace-scoped); the caller must be a member of that workspace.
const listQuery = z.object({
  workspaceId: z.string().uuid(),
  scopeType: SCOPE.optional(),
});
templateRoutes.get('/', zValidator('query', listQuery), async (c) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
  const { workspaceId, scopeType } = c.req.valid('query');
  if (!(await isWorkspaceMember(workspaceId, userId)))
    return c.json({ error: { code: 'FORBIDDEN', message: 'You do not have access' } }, 403);
  const data = await templateService.list(workspaceId, (scopeType as TemplateScopeType) ?? null);
  return c.json({ data });
});

// ── GET /templates/:id ──
// Workspace-membership gated (resolve the template's workspace, then check).
templateRoutes.get('/:id', async (c) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
  const id = c.req.param('id');
  const tpl = await templateService.getById(id);
  if (!tpl) return c.json({ error: { code: 'NOT_FOUND', message: 'Template not found' } }, 404);
  if (!(await isWorkspaceMember(tpl.workspaceId, userId)))
    return c.json({ error: { code: 'FORBIDDEN', message: 'You do not have access' } }, 403);
  return c.json({ data: tpl });
});

// ── DELETE /templates/:id ──
// Creator OR workspace admin (admin.workspaces.* slug). Mirrors the
// owner-or-admin pattern used elsewhere; resolve the template first for 404.
templateRoutes.delete('/:id', async (c) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
  const id = c.req.param('id');
  const tpl = await templateService.getById(id);
  if (!tpl) return c.json({ error: { code: 'NOT_FOUND', message: 'Template not found' } }, 404);

  let allowed = tpl.createdById === userId;
  if (!allowed) {
    const perms = await roleService.getUserPermissionSlugs(userId, tpl.workspaceId);
    allowed = [...perms].some((p) => p.startsWith('admin.workspaces.'));
  }
  if (!allowed) return c.json({ error: { code: 'FORBIDDEN', message: 'Only the creator or a workspace admin may delete this template' } }, 403);

  const deleted = await templateService.delete(id);
  if (!deleted) return c.json({ error: { code: 'NOT_FOUND', message: 'Template not found' } }, 404);
  return c.json({ data: deleted });
});
