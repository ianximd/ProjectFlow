import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { adminService } from './admin.service.js';
import { roleRoutes } from '../roles/role.routes.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';

// ── Validators ──────────────────────────────────────────────────────────────

const createUserSchema = z.object({
  email:           z.string().email().max(255),
  name:            z.string().min(1).max(255),
  // Optional. When omitted the API generates a temporary password and returns
  // it in the response (one-shot — the admin must capture it then).
  password:        z.string().min(8).max(200).optional(),
  isEmailVerified: z.boolean().optional(),
});

const updateUserSchema = z.object({
  email: z.string().email().max(255).optional(),
  name:  z.string().min(1).max(255).optional(),
}).refine((v) => v.email !== undefined || v.name !== undefined, {
  message: 'Provide at least one of: email, name',
});

const bulkSuspendSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(200),
  suspend: z.boolean(),
});

export const adminRoutes = new Hono();

// ── RBAC sub-router (roles, permissions catalog, user-role assignments) ──
adminRoutes.route('/', roleRoutes);

// ── Existing admin endpoints, now gated per-permission ───────────────────

/** GET /admin/stats — platform-wide statistics */
adminRoutes.get('/stats', requirePermission('admin.stats.read'), async (c) => {
  const stats = await adminService.getStats();
  return c.json({ data: stats });
});

/** GET /admin/users — paginated user list */
adminRoutes.get('/users', requirePermission('admin.users.read'), async (c) => {
  const search   = c.req.query('search')   ?? undefined;
  const page     = parseInt(c.req.query('page')     ?? '1',  10);
  const pageSize = parseInt(c.req.query('pageSize') ?? '50', 10);
  const { users, total } = await adminService.listUsers(search, page, pageSize);
  return c.json({ data: users, meta: { total, page, pageSize } });
});

/** POST /admin/users — admin-create a user account */
adminRoutes.post(
  '/users',
  requirePermission('admin.users.create'),
  zValidator('json', createUserSchema),
  async (c) => {
    const body = c.req.valid('json');
    try {
      const { user, tempPassword } = await adminService.createUser(
        body.email,
        body.name,
        body.password,
        body.isEmailVerified ?? true,
      );
      return c.json({ data: user, meta: { tempPassword } }, 201);
    } catch (err: any) {
      if (err.number === 50001) return c.json({ error: { code: 'CONFLICT', message: err.message } }, 409);
      console.error('[adminRoutes] createUser failed:', err);
      return c.json({ error: { message: 'Internal Server Error' } }, 500);
    }
  },
);

/** PATCH /admin/users/:id — edit name / email */
adminRoutes.patch(
  '/users/:id',
  requirePermission('admin.users.update'),
  zValidator('json', updateUserSchema),
  async (c) => {
    const id   = c.req.param('id')!;
    const body = c.req.valid('json');
    try {
      const user = await adminService.updateUser(id, body);
      if (!user) return c.json({ error: { code: 'NOT_FOUND', message: 'User not found' } }, 404);
      return c.json({ data: user });
    } catch (err: any) {
      if (err.number === 50001) return c.json({ error: { code: 'CONFLICT', message: err.message } }, 409);
      if (err.number === 50004) return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
      console.error('[adminRoutes] updateUser failed:', err);
      return c.json({ error: { message: 'Internal Server Error' } }, 500);
    }
  },
);

/** DELETE /admin/users/:id — permanent delete (refuses if references exist) */
adminRoutes.delete(
  '/users/:id',
  requirePermission('admin.users.delete'),
  async (c) => {
    try {
      await adminService.hardDeleteUser(c.req.param('id')!);
      return c.body(null, 204);
    } catch (err: any) {
      if (err.number === 50004) return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
      // 51040 = blocked by FK references; the message lists the blockers.
      if (err.number === 51040) return c.json({ error: { code: 'CONFLICT', message: err.message } }, 409);
      console.error('[adminRoutes] hardDeleteUser failed:', err);
      return c.json({ error: { message: 'Internal Server Error' } }, 500);
    }
  },
);

/** POST /admin/users/:id/reset-password — generate temp password (returned once) */
adminRoutes.post(
  '/users/:id/reset-password',
  requirePermission('admin.users.reset_password'),
  async (c) => {
    try {
      const tempPassword = await adminService.resetPassword(c.req.param('id')!);
      return c.json({ data: { tempPassword } });
    } catch (err: any) {
      if (err.number === 50004) return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
      console.error('[adminRoutes] resetPassword failed:', err);
      return c.json({ error: { message: 'Internal Server Error' } }, 500);
    }
  },
);

/** POST /admin/users/:id/disable-mfa — clear MFA secret + recovery codes */
adminRoutes.post(
  '/users/:id/disable-mfa',
  requirePermission('admin.users.reset_mfa'),
  async (c) => {
    try {
      await adminService.disableMfa(c.req.param('id')!);
      return c.json({ data: { ok: true } });
    } catch (err: any) {
      if (err.number === 50004) return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
      console.error('[adminRoutes] disableMfa failed:', err);
      return c.json({ error: { message: 'Internal Server Error' } }, 500);
    }
  },
);

/** POST /admin/users/:id/unlock — clear lockout + failed-login counter */
adminRoutes.post(
  '/users/:id/unlock',
  requirePermission('admin.users.reset_mfa'),
  async (c) => {
    try {
      await adminService.unlockUser(c.req.param('id')!);
      return c.json({ data: { ok: true } });
    } catch (err: any) {
      if (err.number === 50004) return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
      console.error('[adminRoutes] unlockUser failed:', err);
      return c.json({ error: { message: 'Internal Server Error' } }, 500);
    }
  },
);

/** POST /admin/users/bulk-suspend — { userIds[], suspend } */
adminRoutes.post(
  '/users/bulk-suspend',
  requirePermission('admin.users.suspend'),
  zValidator('json', bulkSuspendSchema),
  async (c) => {
    const { userIds, suspend } = c.req.valid('json');
    const results = await adminService.bulkSuspend(userIds, suspend);
    return c.json({ data: results });
  },
);

/** POST /admin/users/:id/suspend — soft-delete (suspend) a user */
adminRoutes.post('/users/:id/suspend', requirePermission('admin.users.suspend'), async (c) => {
  const user = await adminService.toggleUserActive(c.req.param('id')!, true);
  if (!user) return c.json({ error: { code: 'NOT_FOUND', message: 'User not found', statusCode: 404 } }, 404);
  return c.json({ data: user });
});

/** POST /admin/users/:id/restore — restore a suspended user */
adminRoutes.post('/users/:id/restore', requirePermission('admin.users.suspend'), async (c) => {
  const user = await adminService.toggleUserActive(c.req.param('id')!, false);
  if (!user) return c.json({ error: { code: 'NOT_FOUND', message: 'User not found', statusCode: 404 } }, 404);
  return c.json({ data: user });
});

/** GET /admin/workspaces — paginated workspace list */
adminRoutes.get('/workspaces', requirePermission('admin.workspaces.read'), async (c) => {
  const page     = parseInt(c.req.query('page')     ?? '1',  10);
  const pageSize = parseInt(c.req.query('pageSize') ?? '50', 10);
  const { workspaces, total } = await adminService.listWorkspaces(page, pageSize);
  return c.json({ data: workspaces, meta: { total, page, pageSize } });
});

/** GET /admin/audit-log — filterable audit log */
adminRoutes.get('/audit-log', requirePermission('admin.audit.read'), async (c) => {
  const q        = c.req.query;
  const page     = parseInt(q('page')     ?? '1',  10);
  const pageSize = parseInt(q('pageSize') ?? '50', 10);
  const { entries, total } = await adminService.listAuditLog({
    workspaceId: q('workspaceId') || undefined,
    userId:      q('userId')      || undefined,
    resource:    q('resource')    || undefined,
    action:      q('action')      || undefined,
    resourceId:  q('resourceId')  || undefined,
    fromDate:    q('fromDate')    ? new Date(q('fromDate')!) : undefined,
    toDate:      q('toDate')      ? new Date(q('toDate')!)   : undefined,
    page,
    pageSize,
  });
  return c.json({ data: entries, meta: { total, page, pageSize } });
});
