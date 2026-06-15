import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { guestService } from '../modules/guests/guest.service.js';
import { GuestObjectScopeError } from '../modules/guests/guest.pure.js';
import { GuestRepository } from '../modules/guests/guest.repository.js';
import { WorkspaceRepository } from '../modules/workspaces/workspace.repository.js';
import { AuthRepository } from '../modules/auth/auth.repository.js';
import { requireObjectLevel, requireWorkspacePermission, notFound } from './authz.js';
import type { GuestInvite, Guest, GuestGrant, HierarchyNodeType, ObjectPermissionLevel } from '@projectflow/types';

const inviteRepo    = new GuestRepository();
const workspaceRepo = new WorkspaceRepository();
const authRepo      = new AuthRepository();

export function registerGuestGraphql(): void {
  // ── GuestGrant: objectType / objectId / level triple ──────────────────────
  const GuestGrantType = builder.objectRef<GuestGrant>('GuestGrant');
  GuestGrantType.implement({
    fields: (t) => ({
      objectType: t.exposeString('objectType'),
      objectId:   t.exposeString('objectId'),
      level:      t.exposeString('level'),
    }),
  });

  // ── GuestInvite: pending invite row ───────────────────────────────────────
  const GuestInviteType = builder.objectRef<GuestInvite>('GuestInvite');
  GuestInviteType.implement({
    fields: (t) => ({
      id:          t.exposeString('id'),
      workspaceId: t.exposeString('workspaceId'),
      email:       t.exposeString('email'),
      objectType:  t.exposeString('objectType'),
      objectId:    t.exposeString('objectId'),
      level:       t.exposeString('level'),
      token:       t.exposeString('token'),
      status:      t.exposeString('status'),
      invitedBy:   t.exposeString('invitedBy'),
      // GuestInvite.expiresAt / acceptedAt are `string | null`
      expiresAt:   t.exposeString('expiresAt',  { nullable: true }),
      acceptedAt:  t.exposeString('acceptedAt', { nullable: true }),
      // createdAt is a string ISO timestamp; surface as the registered Date scalar
      createdAt:   t.field({ type: 'Date', resolve: (g) => new Date(g.createdAt) }),
    }),
  });

  // ── Guest: an accepted workspace guest with their grants ──────────────────
  const GuestType = builder.objectRef<Guest>('Guest');
  GuestType.implement({
    fields: (t) => ({
      userId:    t.exposeString('userId'),
      email:     t.exposeString('email'),
      name:      t.exposeString('name'),
      avatarUrl: t.string({ nullable: true, resolve: (g) => g.avatarUrl ?? null }),
      roleSlug:  t.exposeString('roleSlug'),
      grants:    t.field({ type: [GuestGrantType], resolve: (g) => g.grants }),
    }),
  });

  // ── Query: workspaceGuests ─────────────────────────────────────────────────
  builder.queryFields((t) => ({
    workspaceGuests: t.field({
      type: [GuestType],
      args: { workspaceId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, 'guest.manage');
        return (await guestService.list(a.workspaceId)).guests;
      },
    }),
  }));

  // ── Mutations ──────────────────────────────────────────────────────────────
  builder.mutationFields((t) => ({
    /**
     * Invite a guest to a hierarchy object. Requires FULL on the target object
     * (mirrors the REST POST /guests/invite gate). GuestObjectScopeError is
     * re-thrown as GUEST_SPACE_SCOPE_FORBIDDEN.
     */
    inviteGuest: t.field({
      type: GuestInviteType,
      args: {
        workspaceId: t.arg.string({ required: true }),
        email:       t.arg.string({ required: true }),
        objectType:  t.arg.string({ required: true }),
        objectId:    t.arg.string({ required: true }),
        level:       t.arg.string({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        // FULL on the target object — identical gate to the REST route.
        await requireObjectLevel(ctx, a.objectType as HierarchyNodeType, a.objectId, 'FULL');
        try {
          const { invite } = await guestService.invite(
            {
              workspaceId: a.workspaceId,
              email:       a.email,
              objectType:  a.objectType as HierarchyNodeType,
              objectId:    a.objectId,
              level:       a.level as ObjectPermissionLevel,
            },
            (ctx.user as any).userId,
          );
          return invite;
        } catch (e) {
          if (e instanceof GuestObjectScopeError) {
            throw new GraphQLError(e.message, { extensions: { code: e.code } });
          }
          throw e;
        }
      },
    }),

    /**
     * Accept a pending invite by token. The authed user's email must match the
     * invite's email — identical to the REST POST /guests/accept/:token gate.
     */
    acceptGuestInvite: t.field({
      type: 'Boolean',
      args: { token: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        if (!ctx.user) {
          throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
        }
        const invite = await inviteRepo.findByToken(a.token);
        // notFound() returns `never` — TypeScript narrows `invite` to GuestInvite below.
        if (!invite) notFound('Invite not found');

        if (invite.status !== 'pending') {
          throw new GraphQLError('This invite is no longer valid', { extensions: { code: 'INVITE_NOT_PENDING' } });
        }
        if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
          throw new GraphQLError('This invite has expired', { extensions: { code: 'INVITE_EXPIRED' } });
        }

        const me = await authRepo.getUserById((ctx.user as any).userId);
        const myEmail = (me as any)?.Email as string | undefined;
        if (!myEmail || myEmail.toLowerCase() !== invite.email.toLowerCase()) {
          throw new GraphQLError('This invite is for a different email', { extensions: { code: 'FORBIDDEN' } });
        }

        const verifiedDomain = await workspaceRepo.getVerifiedDomain(invite.workspaceId);
        await guestService.accept(a.token, (ctx.user as any).userId, myEmail, verifiedDomain);
        return true;
      },
    }),

    /**
     * Revoke a guest's membership from a workspace. Requires guest.manage RBAC
     * slug (mirrors the REST DELETE /guests/:workspaceId/:userId gate).
     */
    revokeGuest: t.field({
      type: 'Boolean',
      args: {
        workspaceId: t.arg.string({ required: true }),
        userId:      t.arg.string({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, 'guest.manage');
        await guestService.revoke(a.workspaceId, { userId: a.userId });
        return true;
      },
    }),
  }));
}
