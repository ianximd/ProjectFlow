import { Hono } from 'hono';
import { shareService } from './share.service.js';

export const publicShareRoutes = new Hono();

// GET /public/share/:token — UNAUTHENTICATED. Resolves a token to a read-only,
// navigation-stripped projection of EXACTLY one object, or 404. No JWT, no
// workspace context, no tree access.
publicShareRoutes.get('/:token', async (c) => {
  const token = c.req.param('token');
  if (!token || token.length > 64) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Share link not found', statusCode: 404 } }, 404);
  }
  const projection = await shareService.resolvePublic(token);
  if (!projection) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Share link not found', statusCode: 404 } }, 404);
  }
  return c.json({ projection });
});
