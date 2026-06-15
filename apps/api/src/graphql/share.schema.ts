import { builder } from './builder.js';
import { shareService } from '../modules/share/share.service.js';
import { accessRequestService } from '../modules/access/access-request.service.js';
import { TaskRepository } from '../modules/tasks/task.repository.js';
import { requireAuth, requireObjectLevel, requireWorkspacePermission, notFound } from './authz.js';
import type { ShareLink, AccessRequest, ShareObjectType, HierarchyNodeType } from '@projectflow/types';

const taskRepo = new TaskRepository();

async function fullTarget(objectType: ShareObjectType, objectId: string): Promise<{ type: HierarchyNodeType; id: string } | null> {
  if (objectType === 'task') {
    const t = await taskRepo.getById(objectId);
    const listId = (t as any)?.listId ?? (t as any)?.ListId ?? null;
    return listId ? { type: 'LIST', id: listId } : null;
  }
  return null;
}

/** Authed GraphQL mirror. The PUBLIC token resolution is REST-only by design. */
export function registerShareGraphql(): void {
  const ShareLinkType = builder.objectRef<ShareLink>('ShareLink');
  ShareLinkType.implement({ fields: (t) => ({
    id:         t.exposeString('id'),
    objectType: t.exposeString('objectType'),
    objectId:   t.exposeString('objectId'),
    token:      t.exposeString('token'),
    level:      t.exposeString('level'),
    expiresAt:  t.string({ nullable: true, resolve: (l) => l.expiresAt ?? null }),
    createdAt:  t.exposeString('createdAt'),
    revokedAt:  t.string({ nullable: true, resolve: (l) => l.revokedAt ?? null }),
  }) });

  const AccessRequestType = builder.objectRef<AccessRequest>('AccessRequest');
  AccessRequestType.implement({ fields: (t) => ({
    id:          t.exposeString('id'),
    objectType:  t.exposeString('objectType'),
    objectId:    t.exposeString('objectId'),
    requestedBy: t.exposeString('requestedBy'),
    note:        t.string({ nullable: true, resolve: (r) => r.note ?? null }),
    status:      t.exposeString('status'),
    createdAt:   t.exposeString('createdAt'),
  }) });

  builder.queryFields((t) => ({
    shareLinksForObject: t.field({
      type: [ShareLinkType],
      args: { objectType: t.arg.string({ required: true }), objectId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const target = await fullTarget(a.objectType as ShareObjectType, a.objectId);
        if (!target) notFound();
        await requireObjectLevel(ctx, target!.type, target!.id, 'FULL');
        return shareService.listForObject(a.objectType as ShareObjectType, a.objectId);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    createShareLink: t.field({
      type: ShareLinkType,
      args: { objectType: t.arg.string({ required: true }), objectId: t.arg.string({ required: true }), expiresAt: t.arg.string({ required: false }) },
      resolve: async (_, a, ctx) => {
        const workspaceId = await shareService.getObjectWorkspaceId(a.objectType as ShareObjectType, a.objectId);
        await requireWorkspacePermission(ctx, workspaceId, 'share.create');
        const target = await fullTarget(a.objectType as ShareObjectType, a.objectId);
        if (!target) notFound();
        await requireObjectLevel(ctx, target!.type, target!.id, 'FULL');
        return shareService.createLink(
          workspaceId!,
          { objectType: a.objectType as ShareObjectType, objectId: a.objectId, expiresAt: a.expiresAt ?? null },
          (ctx.user as any).userId,
        );
      },
    }),
    revokeShareLink: t.field({
      type: 'Boolean',
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        const link = await shareService.getLinkById(a.id);
        if (!link) notFound();
        const target = await fullTarget(link!.objectType, link!.objectId);
        if (!target) notFound();
        await requireObjectLevel(ctx, target!.type, target!.id, 'FULL');
        await shareService.revokeLink(a.id);
        return true;
      },
    }),
    requestAccess: t.field({
      type: AccessRequestType,
      args: { objectType: t.arg.string({ required: true }), objectId: t.arg.string({ required: true }), note: t.arg.string({ required: false }) },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        return accessRequestService.requestAccess(a.objectType as ShareObjectType, a.objectId, (ctx.user as any).userId, a.note ?? undefined);
      },
    }),
    resolveAccessRequest: t.field({
      type: AccessRequestType,
      nullable: true,
      args: { id: t.arg.string({ required: true }), decision: t.arg.string({ required: true }), level: t.arg.string({ required: false }) },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        const peek = await accessRequestService.getRequestById(a.id);
        if (!peek) notFound();
        const target = await fullTarget(peek!.objectType, peek!.objectId);
        if (!target) notFound();
        await requireObjectLevel(ctx, target!.type, target!.id, 'FULL');
        return accessRequestService.resolveRequest(
          a.id, (ctx.user as any).userId, a.decision as 'granted' | 'denied',
          (a.level as any) ?? 'EDIT', (ctx.user as any).email ?? null,
        );
      },
    }),
  }));
}
