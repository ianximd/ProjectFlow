import { Hono } from 'hono';
import { notificationService } from './notification.service.js';

export const notificationRoutes = new Hono();

// GET /api/v1/notifications?page=&pageSize=&unreadOnly=
notificationRoutes.get('/', async (c) => {
  const user       = (c as any).get('user') as any;
  const page       = parseInt(c.req.query('page')     ?? '1',  10);
  const pageSize   = parseInt(c.req.query('pageSize') ?? '20', 10);
  const unreadOnly = c.req.query('unreadOnly') === 'true';

  const typesParam = c.req.query('types');
  const types      = typesParam ? typesParam.split(',').map(s => s.trim()).filter(Boolean) : undefined;
  const savedOnly  = c.req.query('savedOnly') === 'true';

  const { notifications, unreadCount } = await notificationService.list(
    user.userId, page, Math.min(pageSize, 50), unreadOnly, types, savedOnly,
  );

  return c.json({ data: notifications, meta: { unreadCount } });
});

// PATCH /api/v1/notifications/mark-all-read
notificationRoutes.patch('/mark-all-read', async (c) => {
  const user = (c as any).get('user') as any;
  const count = await notificationService.markAllRead(user.userId);
  return c.json({ data: { updatedCount: count } });
});

// PATCH /api/v1/notifications/:id/read
notificationRoutes.patch('/:id/read', async (c) => {
  const user = (c as any).get('user') as any;
  try {
    await notificationService.markRead(c.req.param('id'), user.userId);
    return c.body(null, 204);
  } catch {
    return c.json({ error: { message: 'Notification not found' } }, 404);
  }
});

// PATCH /api/v1/notifications/:id/saved
notificationRoutes.patch('/:id/saved', async (c) => {
  const user = (c as any).get('user') as any;
  const body = await c.req.json().catch(() => ({}));
  try {
    await notificationService.setSaved(c.req.param('id'), user.userId, Boolean(body.saved));
    return c.body(null, 204);
  } catch {
    return c.json({ error: { message: 'Notification not found' } }, 404);
  }
});
