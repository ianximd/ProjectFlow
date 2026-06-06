import { Hono } from 'hono';
import type { Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  templateService, TemplateSourceNotFoundError,
  TemplateNotFoundError, TemplateTargetNotFoundError, TemplateWorkspaceMismatchError,
} from './template.service.js';
import { TemplateApplyError } from './template.apply.js';
import { requireObjectAccess } from '../access/access.middleware.js';
import { roleService } from '../roles/role.service.js';
import { accessService, LEVEL_ORDER } from '../access/access.service.js';
import { isWorkspaceMember } from '../workspaces/membership.js';
import type { TemplateScopeType, HierarchyNodeType } from '@projectflow/types';

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

// ── POST /templates/:id/apply ──
// Recreate the template's captured subtree under a target, remapping dates onto
// anchorDate. Authz is scope-dependent (resolved from the template's scopeType):
//   SPACE  → workspace 'project.create'  (targetParentId = workspaceId)
//   FOLDER → object-level EDIT on the target Space/Folder
//   LIST   → object-level EDIT on the target Space/Folder
//   TASK   → object-level EDIT on the target List
// The cross-workspace guard (template.ws === target.ws) lives in the service.
const applySchema = z.object({
  targetParentId:  z.string().uuid(),
  anchorDate:      z.string().min(1),
  selectedItemIds: z.array(z.string()).optional(),
});
templateRoutes.post('/:id/apply', zValidator('json', applySchema), async (c) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const tpl = await templateService.getById(id);
  if (!tpl) return c.json({ error: { code: 'NOT_FOUND', message: 'Template not found' } }, 404);

  // ── Scope-dependent create authz at the target ──
  if (tpl.scopeType === 'SPACE') {
    // targetParentId is the workspace the new Space is created in.
    const perms = await roleService.getUserPermissionSlugs(userId, body.targetParentId);
    if (!perms.has('project.create'))
      return c.json({ error: { code: 'FORBIDDEN', message: "Permission 'project.create' required" } }, 403);
  } else {
    // FOLDER/LIST land under a SPACE or FOLDER; TASK lands under a LIST.
    // requireObjectAccess(EDIT) semantics, inline (the object type is dynamic).
    let objType: HierarchyNodeType;
    if (tpl.scopeType === 'TASK') {
      objType = 'LIST';
    } else {
      const t = await templateService.resolveContainerTargetType(body.targetParentId);
      if (!t) return c.json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } }, 404);
      objType = t;
    }
    const { level, found } = await accessService.resolveOrNull(userId, objType, body.targetParentId);
    if (!found) return c.json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } }, 404);
    if (!level || LEVEL_ORDER[level] < LEVEL_ORDER['EDIT'])
      return c.json({ error: { code: 'FORBIDDEN', message: 'You do not have access' } }, 403);
  }

  try {
    const result = await templateService.apply(id, {
      targetParentId: body.targetParentId,
      anchorDate: body.anchorDate,
      selectedItemIds: body.selectedItemIds,
    }, userId);
    return c.json({ data: result }, 201);
  } catch (err) {
    if (err instanceof TemplateNotFoundError)
      return c.json({ error: { code: err.code, message: err.message } }, 404);
    if (err instanceof TemplateTargetNotFoundError)
      return c.json({ error: { code: err.code, message: err.message } }, 404);
    if (err instanceof TemplateWorkspaceMismatchError)
      return c.json({ error: { code: err.code, message: err.message } }, 404);
    if (err instanceof TemplateApplyError)
      return c.json({ error: { code: err.code, message: err.message } }, 400);
    throw err;
  }
});
