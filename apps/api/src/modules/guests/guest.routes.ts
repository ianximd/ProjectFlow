import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { guestService } from './guest.service.js';
import { GuestObjectScopeError } from './guest.pure.js';
import { GuestRepository } from './guest.repository.js';
import { requireObjectAccess } from '../access/access.middleware.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';
import { WorkspaceRepository } from '../workspaces/workspace.repository.js';
import { AuthRepository } from '../auth/auth.repository.js';

export const guestRoutes = new Hono();
const workspaceRepo = new WorkspaceRepository();
const authRepo = new AuthRepository();
const inviteRepo = new GuestRepository();

const inviteSchema = z.object({
  workspaceId: z.string().uuid(),
  email:       z.string().email(),
  objectType:  z.enum(['SPACE', 'FOLDER', 'LIST']),
  objectId:    z.string().uuid(),
  level:       z.enum(['VIEW', 'COMMENT', 'EDIT', 'FULL']),
  expiresAt:   z.string().datetime().optional(),
});

// POST /guests/invites — requires FULL on the target object (only someone who
// fully controls an object may share it / grant access).
guestRoutes.post('/invites', zValidator('json', inviteSchema),
  requireObjectAccess('FULL', (c) => {
    const b = (c.req as any).valid('json');
    return { type: b.objectType, id: b.objectId };
  }),
  async (c) => {
    const invitedBy = ((c as any).get('user') as any).userId as string;
    const input = c.req.valid('json');
    try {
      const { invite, role } = await guestService.invite(input, invitedBy);
      return c.json({ invite, role }, 201);
    } catch (e) {
      if (e instanceof GuestObjectScopeError) {
        return c.json({ error: { code: e.code, message: e.message, statusCode: 422 } }, 422);
      }
      throw e;
    }
  },
);

// POST /guests/invites/:token/accept — the authed user accepts; their email
// must match the invite email.
guestRoutes.post('/invites/:token/accept', async (c) => {
  const user = (c as any).get('user') as any;
  if (!user?.userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
  const token = c.req.param('token');
  const invite = await inviteRepo.findByToken(token);
  if (!invite) return c.json({ error: { code: 'NOT_FOUND', message: 'Invite not found' } }, 404);
  // Clean errors for non-pending / expired invites. usp_GuestInvite_Accept also
  // enforces these atomically (THROW 51411/51412) as the race-safe backstop.
  if (invite.status !== 'pending') {
    return c.json({ error: { code: 'INVITE_NOT_PENDING', message: 'This invite is no longer valid' } }, 409);
  }
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    return c.json({ error: { code: 'INVITE_EXPIRED', message: 'This invite has expired' } }, 410);
  }
  const me = await authRepo.getUserById(user.userId);
  const myEmail = (me as any)?.Email as string | undefined;
  if (!myEmail || myEmail.toLowerCase() !== invite.email.toLowerCase()) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'This invite is for a different email' } }, 403);
  }
  const verifiedDomain = await workspaceRepo.getVerifiedDomain(invite.workspaceId);
  const result = await guestService.accept(token, user.userId, myEmail, verifiedDomain);
  return c.json({ accepted: result }, 200);
});

// DELETE /guests/invites/:inviteId — cancel a pending invite (registered BEFORE
// the /:userId route so the static 'invites' segment wins).
guestRoutes.delete('/invites/:inviteId', zValidator('query', z.object({ workspaceId: z.string().uuid() })),
  requirePermission('guest.manage', { workspaceParam: 'workspaceId' }),
  async (c) => {
    await guestService.revoke(c.req.query('workspaceId')!, { inviteId: c.req.param('inviteId') });
    return c.json({ ok: true });
  },
);

// GET /guests?workspaceId= — list guests + pending (guest.manage).
guestRoutes.get('/', zValidator('query', z.object({ workspaceId: z.string().uuid() })),
  requirePermission('guest.manage', { workspaceParam: 'workspaceId' }),
  async (c) => c.json(await guestService.list(c.req.query('workspaceId')!)),
);

// DELETE /guests/:userId?workspaceId= — revoke an accepted guest (guest.manage).
guestRoutes.delete('/:userId', zValidator('query', z.object({ workspaceId: z.string().uuid() })),
  requirePermission('guest.manage', { workspaceParam: 'workspaceId' }),
  async (c) => {
    await guestService.revoke(c.req.query('workspaceId')!, { userId: c.req.param('userId') });
    return c.json({ ok: true });
  },
);
