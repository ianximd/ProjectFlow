import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { workspaceService } from './workspace.service.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';

const inviteByEmailSchema = z.object({
  email: z.string().email().max(255),
  role:  z.enum(['ADMIN', 'MEMBER', 'VIEWER']).optional(),
});

const setRoleSchema = z.object({
  role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']),
});

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

// GET /api/v1/workspaces/:id/members — used by the assignee picker.
// Read-only list; granted to every workspace role via 'workspace.members.read'.
workspaceRoutes.get(
  '/:id/members',
  requirePermission('workspace.members.read', { workspaceParam: 'id' }),
  async (c) => {
    const members = await workspaceService.listMembers(c.req.param('id')!);
    return c.json({ data: members });
  },
);

// POST /api/v1/workspaces/:id/members — invite by userId (existing flow)
workspaceRoutes.post(
  '/:id/members',
  requirePermission('workspace.members.invite', { workspaceParam: 'id' }),
  async (c) => {
    const { userId, role } = await c.req.json();
    if (!userId) return c.json({ error: { message: 'userId is required' } }, 400);
    try {
      const member = await workspaceService.addMember(c.req.param('id')!, userId, role);
      return c.json({ data: member }, 201);
    } catch (err: any) {
      if (err.number === 50011) return c.json({ error: { message: err.message } }, 409);
      return c.json({ error: { message: 'Internal Server Error' } }, 500);
    }
  },
);

// POST /api/v1/workspaces/:id/members/by-email — invite an existing user
// without needing to know their internal id. The SP throws 51052 if no
// user exists with that email.
workspaceRoutes.post(
  '/:id/members/by-email',
  requirePermission('workspace.members.invite', { workspaceParam: 'id' }),
  zValidator('json', inviteByEmailSchema),
  async (c) => {
    const { email, role } = c.req.valid('json');
    try {
      const member = await workspaceService.addMemberByEmail(c.req.param('id')!, email, role);
      return c.json({ data: member }, 201);
    } catch (err: any) {
      if (err.number === 51052) return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
      console.error('[workspaceRoutes] addMemberByEmail failed:', err);
      return c.json({ error: { message: 'Internal Server Error' } }, 500);
    }
  },
);

// DELETE /api/v1/workspaces/:id/members/:userId — remove a member
workspaceRoutes.delete(
  '/:id/members/:userId',
  requirePermission('workspace.members.remove', { workspaceParam: 'id' }),
  async (c) => {
    try {
      await workspaceService.removeMember(c.req.param('id')!, c.req.param('userId')!);
      return c.body(null, 204);
    } catch (err: any) {
      if (err.number === 51050) return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
      if (err.number === 51051) return c.json({ error: { code: 'CONFLICT',  message: err.message } }, 409);
      console.error('[workspaceRoutes] removeMember failed:', err);
      return c.json({ error: { message: 'Internal Server Error' } }, 500);
    }
  },
);

// PUT /api/v1/workspaces/:id/members/:userId/role — change a member's role
workspaceRoutes.put(
  '/:id/members/:userId/role',
  requirePermission('workspace.members.assign_role', { workspaceParam: 'id' }),
  zValidator('json', setRoleSchema),
  async (c) => {
    const { role } = c.req.valid('json');
    try {
      const result = await workspaceService.setMemberRole(
        c.req.param('id')!,
        c.req.param('userId')!,
        role,
      );
      return c.json({ data: result });
    } catch (err: any) {
      if (err.number === 51050) return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
      if (err.number === 51053) return c.json({ error: { code: 'CONFLICT',  message: err.message } }, 409);
      if (err.number === 51054 || err.number === 51055)
        return c.json({ error: { code: 'BAD_REQUEST', message: err.message } }, 400);
      console.error('[workspaceRoutes] setMemberRole failed:', err);
      return c.json({ error: { message: 'Internal Server Error' } }, 500);
    }
  },
);

// PATCH /api/v1/workspaces/:id
workspaceRoutes.patch(
  '/:id',
  requirePermission('workspace.update', { workspaceParam: 'id' }),
  async (c) => {
    const { name, slug, avatarUrl } = await c.req.json();
    try {
      const workspace = await workspaceService.update(c.req.param('id')!, { name, slug, avatarUrl });
      if (!workspace) return c.json({ error: { message: 'Workspace not found' } }, 404);
      return c.json({ data: workspace });
    } catch (err: any) {
      return c.json({ error: { message: 'Internal Server Error' } }, 500);
    }
  },
);

// DELETE /api/v1/workspaces/:id
workspaceRoutes.delete(
  '/:id',
  requirePermission(['workspace.delete', 'admin.workspaces.delete'], { workspaceParam: 'id' }),
  async (c) => {
    try {
      await workspaceService.delete(c.req.param('id')!);
      return c.body(null, 204);
    } catch (err: any) {
      return c.json({ error: { message: 'Internal Server Error' } }, 500);
    }
  },
);
