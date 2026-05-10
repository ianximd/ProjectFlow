import { Hono } from 'hono';
import { workspaceService } from './workspace.service.js';

export const workspaceRoutes = new Hono();

// POST /api/v1/workspaces
workspaceRoutes.post('/', async (c) => {
  const { name, slug } = await c.req.json();
  if (!name || !slug) return c.json({ error: { message: 'name and slug are required' } }, 400);
  const user = (c as any).get('user') as any;
  try {
    const workspace = await workspaceService.create(name, slug, user.userId);
    return c.json({ data: workspace }, 201);
  } catch (err: any) {
    if (err.number === 50010) return c.json({ error: { message: err.message } }, 409);
    return c.json({ error: { message: 'Internal Server Error' } }, 500);
  }
});

// GET /api/v1/workspaces
workspaceRoutes.get('/', async (c) => {
  const user = (c as any).get('user') as any;
  const workspaces = await workspaceService.list(user.userId);
  return c.json({ data: workspaces });
});

// GET /api/v1/workspaces/:id
workspaceRoutes.get('/:id', async (c) => {
  const workspace = await workspaceService.getById(c.req.param('id'));
  if (!workspace) return c.json({ error: { message: 'Workspace not found' } }, 404);
  return c.json({ data: workspace });
});

// POST /api/v1/workspaces/:id/members
workspaceRoutes.post('/:id/members', async (c) => {
  const { userId, role } = await c.req.json();
  if (!userId) return c.json({ error: { message: 'userId is required' } }, 400);
  try {
    const member = await workspaceService.addMember(c.req.param('id'), userId, role);
    return c.json({ data: member }, 201);
  } catch (err: any) {
    if (err.number === 50011) return c.json({ error: { message: err.message } }, 409);
    return c.json({ error: { message: 'Internal Server Error' } }, 500);
  }
});

// PATCH /api/v1/workspaces/:id
workspaceRoutes.patch('/:id', async (c) => {
  const { name, slug, avatarUrl } = await c.req.json();
  try {
    const workspace = await workspaceService.update(c.req.param('id'), { name, slug, avatarUrl });
    if (!workspace) return c.json({ error: { message: 'Workspace not found' } }, 404);
    return c.json({ data: workspace });
  } catch (err: any) {
    return c.json({ error: { message: 'Internal Server Error' } }, 500);
  }
});

// DELETE /api/v1/workspaces/:id
workspaceRoutes.delete('/:id', async (c) => {
  try {
    await workspaceService.delete(c.req.param('id'));
    return c.body(null, 204);
  } catch (err: any) {
    return c.json({ error: { message: 'Internal Server Error' } }, 500);
  }
});
