import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { adminService } from './admin.service.js';

// ─── Admin role guard ─────────────────────────────────────────────────────────
// Admin users are identified by their userId appearing in the ADMIN_USER_IDS
// environment variable (comma-separated). This avoids adding a `role` column
// to the DB for now; switch to a DB-based role check when needed.
const ADMIN_IDS = new Set(
  (process.env.ADMIN_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
);

export async function requireAdmin(c: Context, next: Next) {
  const user: any = (c as any).get('user');
  const userId = user?.userId ?? user?.id ?? '';
  if (!ADMIN_IDS.has(userId)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Admin access required', statusCode: 403 } }, 403);
  }
  await next();
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export const adminRoutes = new Hono();

// All admin routes additionally require admin role on top of authMiddleware
adminRoutes.use('*', requireAdmin);

/** GET /admin/stats — platform-wide statistics */
adminRoutes.get('/stats', async (c) => {
  const stats = await adminService.getStats();
  return c.json({ data: stats });
});

/** GET /admin/users — paginated user list */
adminRoutes.get('/users', async (c) => {
  const search   = c.req.query('search')   ?? undefined;
  const page     = parseInt(c.req.query('page')     ?? '1',  10);
  const pageSize = parseInt(c.req.query('pageSize') ?? '50', 10);
  const { users, total } = await adminService.listUsers(search, page, pageSize);
  return c.json({ data: users, meta: { total, page, pageSize } });
});

/** POST /admin/users/:id/suspend — soft-delete (suspend) a user */
adminRoutes.post('/users/:id/suspend', async (c) => {
  const user = await adminService.toggleUserActive(c.req.param('id'), true);
  if (!user) return c.json({ error: { code: 'NOT_FOUND', message: 'User not found', statusCode: 404 } }, 404);
  return c.json({ data: user });
});

/** POST /admin/users/:id/restore — restore a suspended user */
adminRoutes.post('/users/:id/restore', async (c) => {
  const user = await adminService.toggleUserActive(c.req.param('id'), false);
  if (!user) return c.json({ error: { code: 'NOT_FOUND', message: 'User not found', statusCode: 404 } }, 404);
  return c.json({ data: user });
});

/** GET /admin/workspaces — paginated workspace list */
adminRoutes.get('/workspaces', async (c) => {
  const page     = parseInt(c.req.query('page')     ?? '1',  10);
  const pageSize = parseInt(c.req.query('pageSize') ?? '50', 10);
  const { workspaces, total } = await adminService.listWorkspaces(page, pageSize);
  return c.json({ data: workspaces, meta: { total, page, pageSize } });
});

/** GET /admin/audit-log — filterable audit log */
adminRoutes.get('/audit-log', async (c) => {
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
