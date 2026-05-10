import { Hono } from 'hono';
import { adminService } from './admin.service.js';
import { roleRoutes } from '../roles/role.routes.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';

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
