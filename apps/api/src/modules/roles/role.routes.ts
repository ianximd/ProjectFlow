import { Hono } from 'hono';
import type { RoleScope } from '@projectflow/types';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';
import { roleService } from './role.service.js';

export const roleRoutes = new Hono();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseScope(value: string | undefined): RoleScope | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase();
  return upper === 'SYSTEM' || upper === 'WORKSPACE' ? upper : undefined;
}

function getActorId(c: any): string | null {
  const user = c.get('user');
  return user?.userId ?? user?.id ?? null;
}

function actorEmail(c: any): string | null {
  const u = c.get('user');
  return u?.email ?? null;
}

function notFound(c: any, message = 'Not found') {
  return c.json({ error: { code: 'NOT_FOUND', message, statusCode: 404 } }, 404);
}

function badRequest(c: any, message: string) {
  return c.json({ error: { code: 'BAD_REQUEST', message, statusCode: 400 } }, 400);
}

function conflict(c: any, message: string) {
  return c.json({ error: { code: 'CONFLICT', message, statusCode: 409 } }, 409);
}

/** Map known sproc THROW errors to clean HTTP responses. */
function mapSqlError(c: any, err: unknown) {
  const msg = (err as Error)?.message ?? '';
  // Slug already exists / can't delete built-in / has assignments → conflict
  if (/already exists/i.test(msg)) return conflict(c, msg);
  if (/Cannot delete a built-in role/i.test(msg)) return conflict(c, msg);
  if (/active assignments/i.test(msg))            return conflict(c, msg);
  if (/Cannot revoke the last super-admin/i.test(msg)) return conflict(c, msg);
  // Validation errors → 400
  if (/scope|workspace|permission|role|unknown|must be/i.test(msg)) return badRequest(c, msg);
  throw err;
}

// ─── Permissions catalog ─────────────────────────────────────────────────────

/** GET /admin/permissions?scope=SYSTEM|WORKSPACE — list all permission slugs */
roleRoutes.get(
  '/permissions',
  requirePermission('admin.roles.manage'),
  async (c) => {
    const scope = parseScope(c.req.query('scope'));
    const perms = await roleService.listPermissions(scope);
    return c.json({ data: perms });
  },
);

// ─── Roles ───────────────────────────────────────────────────────────────────

/** GET /admin/roles?scope= — list roles with permission/member counts */
roleRoutes.get(
  '/roles',
  requirePermission('admin.roles.manage'),
  async (c) => {
    const scope = parseScope(c.req.query('scope'));
    const roles = await roleService.listRoles(scope);
    return c.json({ data: roles });
  },
);

/** GET /admin/roles/:id — role + its permissions */
roleRoutes.get(
  '/roles/:id',
  requirePermission('admin.roles.manage'),
  async (c) => {
    const role = await roleService.getRoleById(c.req.param('id')!);
    if (!role) return notFound(c, 'Role not found');
    return c.json({ data: role });
  },
);

/** POST /admin/roles — create a custom role */
roleRoutes.post(
  '/roles',
  requirePermission('admin.roles.manage'),
  async (c) => {
    let body: any;
    try { body = await c.req.json(); }
    catch { return badRequest(c, 'Invalid JSON body'); }

    const name  = String(body?.name ?? '').trim();
    const scope = parseScope(body?.scope);
    if (!name)  return badRequest(c, 'name is required');
    if (!scope) return badRequest(c, 'scope must be SYSTEM or WORKSPACE');

    try {
      const role = await roleService.createRole({
        name,
        description:   body?.description ?? null,
        scope,
        permissionIds: Array.isArray(body?.permissionIds) ? body.permissionIds : undefined,
      });
      return c.json({ data: role }, 201);
    } catch (err) {
      return mapSqlError(c, err);
    }
  },
);

/** PATCH /admin/roles/:id — edit name/description (built-ins: description only) */
roleRoutes.patch(
  '/roles/:id',
  requirePermission('admin.roles.manage'),
  async (c) => {
    let body: any;
    try { body = await c.req.json(); }
    catch { return badRequest(c, 'Invalid JSON body'); }

    try {
      const updated = await roleService.updateRole(c.req.param('id')!, {
        name:        typeof body?.name        === 'string' ? body.name.trim() : undefined,
        description: body?.description ?? undefined,
      });
      if (!updated) return notFound(c, 'Role not found');
      return c.json({ data: updated });
    } catch (err) {
      return mapSqlError(c, err);
    }
  },
);

/** DELETE /admin/roles/:id — refuses built-ins or roles with active assignments */
roleRoutes.delete(
  '/roles/:id',
  requirePermission('admin.roles.manage'),
  async (c) => {
    try {
      await roleService.deleteRole(c.req.param('id')!);
      return c.json({ data: { deleted: true } });
    } catch (err) {
      return mapSqlError(c, err);
    }
  },
);

/** PUT /admin/roles/:id/permissions — replace the role's permission set */
roleRoutes.put(
  '/roles/:id/permissions',
  requirePermission('admin.roles.manage'),
  async (c) => {
    let body: any;
    try { body = await c.req.json(); }
    catch { return badRequest(c, 'Invalid JSON body'); }

    if (!Array.isArray(body?.permissionIds)) {
      return badRequest(c, 'permissionIds must be an array of UUIDs');
    }
    try {
      const perms = await roleService.setRolePermissions(c.req.param('id')!, body.permissionIds);
      return c.json({ data: perms });
    } catch (err) {
      return mapSqlError(c, err);
    }
  },
);

/** GET /admin/roles/:id/members — users currently holding this role */
roleRoutes.get(
  '/roles/:id/members',
  requirePermission('admin.roles.manage'),
  async (c) => {
    const members = await roleService.listRoleMembers(c.req.param('id')!);
    return c.json({ data: members });
  },
);

// ─── User-role assignments ───────────────────────────────────────────────────

/** GET /admin/user-roles/:userId?workspaceId= — user's roles (system + workspace) */
roleRoutes.get(
  '/user-roles/:userId',
  requirePermission('admin.roles.manage'),
  async (c) => {
    const wsId = c.req.query('workspaceId') || null;
    const rows = await roleService.listUserRoles(c.req.param('userId')!, wsId);
    return c.json({ data: rows });
  },
);

/** POST /admin/user-roles/:userId — assign a role */
roleRoutes.post(
  '/user-roles/:userId',
  requirePermission('admin.roles.manage'),
  async (c) => {
    let body: any;
    try { body = await c.req.json(); }
    catch { return badRequest(c, 'Invalid JSON body'); }

    const roleId      = String(body?.roleId ?? '');
    const workspaceId = body?.workspaceId ?? null;
    if (!roleId) return badRequest(c, 'roleId is required');

    try {
      const assignment = await roleService.assignRole({
        userId:      c.req.param('userId')!,
        roleId,
        workspaceId,
        assignedBy:  getActorId(c),
      });
      return c.json({ data: assignment }, 201);
    } catch (err) {
      return mapSqlError(c, err);
    }
  },
);

/** DELETE /admin/user-roles/:userId/:roleId?workspaceId= — revoke a role */
roleRoutes.delete(
  '/user-roles/:userId/:roleId',
  requirePermission('admin.roles.manage'),
  async (c) => {
    const wsId = c.req.query('workspaceId') || null;
    try {
      const removed = await roleService.revokeRole(
        c.req.param('userId')!,
        c.req.param('roleId')!,
        wsId,
      );
      if (!removed) return notFound(c, 'Assignment not found');
      return c.json({ data: { deleted: true } });
    } catch (err) {
      return mapSqlError(c, err);
    }
  },
);

// ─── Workspace custom roles (Phase 10b) ────────────────────────────────────────

/** GET /admin/workspaces/:workspaceId/permissions — WORKSPACE-scoped permission catalog
 *  (role.manage-gated; the system /admin/permissions is super-admin-only). */
roleRoutes.get(
  '/workspaces/:workspaceId/permissions',
  requirePermission('role.manage', { workspaceParam: 'workspaceId' }),
  async (c) => c.json({ data: await roleService.listPermissions('WORKSPACE') }),
);

/** GET /admin/workspaces/:workspaceId/roles */
roleRoutes.get(
  '/workspaces/:workspaceId/roles',
  requirePermission('role.manage', { workspaceParam: 'workspaceId' }),
  async (c) => c.json({ data: await roleService.listWorkspaceRoles(c.req.param('workspaceId')!) }),
);

/** POST /admin/workspaces/:workspaceId/roles */
roleRoutes.post(
  '/workspaces/:workspaceId/roles',
  requirePermission('role.manage', { workspaceParam: 'workspaceId' }),
  async (c) => {
    let body: any;
    try { body = await c.req.json(); } catch { return badRequest(c, 'Invalid JSON body'); }
    const name = String(body?.name ?? '').trim();
    if (!name) return badRequest(c, 'name is required');
    try {
      const role = await roleService.createWorkspaceRole({
        workspaceId: c.req.param('workspaceId')!, name,
        description: body?.description ?? null,
        permissionIds: Array.isArray(body?.permissionIds) ? body.permissionIds : [],
        actorId: getActorId(c)!, actorEmail: actorEmail(c),
      });
      return c.json({ data: role }, 201);
    } catch (err) { return mapSqlError(c, err); }
  },
);

/** PATCH /admin/workspaces/:workspaceId/roles/:id */
roleRoutes.patch(
  '/workspaces/:workspaceId/roles/:id',
  requirePermission('role.manage', { workspaceParam: 'workspaceId' }),
  async (c) => {
    let body: any;
    try { body = await c.req.json(); } catch { return badRequest(c, 'Invalid JSON body'); }
    try {
      const res = await roleService.updateWorkspaceRole({
        workspaceId: c.req.param('workspaceId')!, roleId: c.req.param('id')!,
        name: typeof body?.name === 'string' ? body.name.trim() : undefined,
        description: body?.description ?? undefined,
        permissionIds: Array.isArray(body?.permissionIds) ? body.permissionIds : undefined,
        actorId: getActorId(c)!, actorEmail: actorEmail(c),
      });
      if (!res.ok) return res.code === 'IMMUTABLE' ? conflict(c, 'System roles are immutable') : notFound(c, 'Role not found');
      return c.json({ data: res.role });
    } catch (err) { return mapSqlError(c, err); }
  },
);

/** DELETE /admin/workspaces/:workspaceId/roles/:id */
roleRoutes.delete(
  '/workspaces/:workspaceId/roles/:id',
  requirePermission('role.manage', { workspaceParam: 'workspaceId' }),
  async (c) => {
    try {
      const res = await roleService.deleteWorkspaceRole({
        workspaceId: c.req.param('workspaceId')!, roleId: c.req.param('id')!,
        actorId: getActorId(c)!, actorEmail: actorEmail(c),
      });
      if (!res.ok) return res.code === 'IMMUTABLE' ? conflict(c, 'System roles are immutable') : notFound(c, 'Role not found');
      return c.json({ data: { deleted: true } });
    } catch (err) { return mapSqlError(c, err); }
  },
);

/** POST /admin/workspaces/:workspaceId/roles/:id/members — assign */
roleRoutes.post(
  '/workspaces/:workspaceId/roles/:id/members',
  requirePermission('role.manage', { workspaceParam: 'workspaceId' }),
  async (c) => {
    let body: any;
    try { body = await c.req.json(); } catch { return badRequest(c, 'Invalid JSON body'); }
    const userId = String(body?.userId ?? '');
    if (!userId) return badRequest(c, 'userId is required');
    try {
      const res = await roleService.assignWorkspaceRole({
        workspaceId: c.req.param('workspaceId')!, roleId: c.req.param('id')!, userId,
        actorId: getActorId(c)!, actorEmail: actorEmail(c),
      });
      if (!res.ok) return notFound(c, 'Role not found in this workspace');
      return c.json({ data: res.assignment }, 201);
    } catch (err) { return mapSqlError(c, err); }
  },
);

/** DELETE /admin/workspaces/:workspaceId/roles/:id/members/:userId — revoke */
roleRoutes.delete(
  '/workspaces/:workspaceId/roles/:id/members/:userId',
  requirePermission('role.manage', { workspaceParam: 'workspaceId' }),
  async (c) => {
    const res = await roleService.revokeWorkspaceRole({
      workspaceId: c.req.param('workspaceId')!, roleId: c.req.param('id')!,
      userId: c.req.param('userId')!, actorId: getActorId(c)!, actorEmail: actorEmail(c),
    });
    if (!res.ok) return notFound(c, 'Assignment not found');
    return c.json({ data: { deleted: true } });
  },
);
