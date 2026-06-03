import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { pubsub } from './pubsub.js';
import { folderService } from '../modules/hierarchy/folder.service.js';
import { listService } from '../modules/hierarchy/list.service.js';
import { mapFolderRow, mapListRow, type FolderShape, type ListShape } from '../modules/hierarchy/map.js';

function requireAuth(ctx: { user: unknown }): asserts ctx is { user: { userId: string } } {
  if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
}

interface EffectiveStatusShape { id: string; name: string; category: string; color: string | null; position: number; }

async function folderParentPath(spaceId: string, parentFolderId: string | null): Promise<string | null> {
  if (!parentFolderId) return folderService.spacePath(spaceId);
  const parent = await folderService.getById(parentFolderId);
  return parent ? (parent as any).Path : null;
}

/**
 * Registers the Folder/List/EffectiveStatus GraphQL surface on the shared
 * Pothos builder. MUST be called from schema.ts immediately before
 * builder.toSchema() so the Query/Mutation root types already exist.
 */
export function registerHierarchyGraphql(): void {
  const FolderType = builder.objectRef<FolderShape>('Folder');
  FolderType.implement({ fields: (t) => ({
    id:             t.exposeString('id'),
    workspaceId:    t.exposeString('workspaceId'),
    spaceId:        t.exposeString('spaceId'),
    parentFolderId: t.string({ nullable: true, resolve: (f) => f.parentFolderId ?? null }),
    name:           t.exposeString('name'),
    position:       t.exposeFloat('position'),
    path:           t.exposeString('path'),
    workflowId:     t.string({ nullable: true, resolve: (f) => f.workflowId ?? null }),
    createdAt:      t.field({ type: 'Date', resolve: (f) => new Date(f.createdAt) }),
  }) });

  const ListType = builder.objectRef<ListShape>('List');
  ListType.implement({ fields: (t) => ({
    id:          t.exposeString('id'),
    workspaceId: t.exposeString('workspaceId'),
    spaceId:     t.exposeString('spaceId'),
    folderId:    t.string({ nullable: true, resolve: (l) => l.folderId ?? null }),
    name:        t.exposeString('name'),
    position:    t.exposeFloat('position'),
    path:        t.exposeString('path'),
    workflowId:  t.string({ nullable: true, resolve: (l) => l.workflowId ?? null }),
    isDefault:   t.exposeBoolean('isDefault'),
    createdAt:   t.field({ type: 'Date', resolve: (l) => new Date(l.createdAt) }),
  }) });

  const EffectiveStatusType = builder.objectRef<EffectiveStatusShape>('EffectiveStatus');
  EffectiveStatusType.implement({ fields: (t) => ({
    id:       t.exposeString('id'),
    name:     t.exposeString('name'),
    category: t.exposeString('category'),
    color:    t.string({ nullable: true, resolve: (s) => s.color ?? null }),
    position: t.exposeFloat('position'),
  }) });

  builder.queryFields((t) => ({
    folders: t.field({
      type: [FolderType],
      args: { spaceId: t.arg.string({ required: true }) },
      resolve: async (_, { spaceId }, ctx) => {
        requireAuth(ctx);
        const rows = await folderService.list(spaceId);
        return (rows as any[]).map(mapFolderRow);
      },
    }),
    lists: t.field({
      type: [ListType],
      args: { spaceId: t.arg.string({ required: true }), folderId: t.arg.string({ required: false }) },
      resolve: async (_, { spaceId, folderId }, ctx) => {
        requireAuth(ctx);
        const rows = await listService.list(spaceId, folderId ?? null, folderId == null);
        return (rows as any[]).map(mapListRow);
      },
    }),
    effectiveStatuses: t.field({
      type: [EffectiveStatusType],
      args: { listId: t.arg.string({ required: true }) },
      resolve: async (_, { listId }, ctx) => {
        requireAuth(ctx);
        return listService.effectiveStatuses(listId);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    createFolder: t.field({
      type: FolderType,
      args: {
        workspaceId: t.arg.string({ required: true }),
        spaceId: t.arg.string({ required: true }),
        parentFolderId: t.arg.string({ required: false }),
        name: t.arg.string({ required: true }),
        position: t.arg.float({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        const parentPath = await folderParentPath(a.spaceId, a.parentFolderId ?? null);
        if (!parentPath) throw new GraphQLError('Parent not found', { extensions: { code: 'NOT_FOUND' } });
        const folder = await folderService.create({
          workspaceId: a.workspaceId, spaceId: a.spaceId, parentFolderId: a.parentFolderId ?? null,
          name: a.name, position: a.position ?? 0, parentPath,
        });
        pubsub.publish('folder:updated', { spaceId: a.spaceId, folder });
        return mapFolderRow(folder);
      },
    }),
    updateFolder: t.field({
      type: FolderType,
      args: { id: t.arg.string({ required: true }), name: t.arg.string({ required: false }), workflowId: t.arg.string({ required: false }) },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        const folder = await folderService.update(a.id, a.name ?? undefined, a.workflowId ?? undefined, a.workflowId === null);
        pubsub.publish('folder:updated', { spaceId: (folder as any).SpaceId, folder });
        return mapFolderRow(folder);
      },
    }),
    moveFolder: t.field({
      type: FolderType,
      args: { id: t.arg.string({ required: true }), parentFolderId: t.arg.string({ required: false }), position: t.arg.float({ required: true }), spaceId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        const newParentPath = await folderParentPath(a.spaceId, a.parentFolderId ?? null);
        if (!newParentPath) throw new GraphQLError('Parent not found', { extensions: { code: 'NOT_FOUND' } });
        const folder = await folderService.move(a.id, a.parentFolderId ?? null, a.position, newParentPath);
        pubsub.publish('folder:updated', { spaceId: a.spaceId, folder });
        return mapFolderRow(folder);
      },
    }),
    deleteFolder: t.field({
      type: FolderType,
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        const folder = await folderService.delete(a.id);
        pubsub.publish('folder:updated', { spaceId: (folder as any).SpaceId, folder });
        return mapFolderRow(folder);
      },
    }),
    createList: t.field({
      type: ListType,
      args: {
        workspaceId: t.arg.string({ required: true }),
        spaceId: t.arg.string({ required: true }),
        folderId: t.arg.string({ required: false }),
        name: t.arg.string({ required: true }),
        position: t.arg.float({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        const parentPath = await listService.parentPath(a.spaceId, a.folderId ?? null);
        if (!parentPath) throw new GraphQLError('Parent not found', { extensions: { code: 'NOT_FOUND' } });
        const list = await listService.create({
          workspaceId: a.workspaceId, spaceId: a.spaceId, folderId: a.folderId ?? null,
          name: a.name, position: a.position ?? 0, parentPath,
        });
        pubsub.publish('list:updated', { spaceId: a.spaceId, list });
        return mapListRow(list);
      },
    }),
    updateList: t.field({
      type: ListType,
      args: { id: t.arg.string({ required: true }), name: t.arg.string({ required: false }), workflowId: t.arg.string({ required: false }) },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        const list = await listService.update(a.id, a.name ?? undefined, a.workflowId ?? undefined, a.workflowId === null);
        pubsub.publish('list:updated', { spaceId: (list as any).SpaceId, list });
        return mapListRow(list);
      },
    }),
    moveList: t.field({
      type: ListType,
      args: { id: t.arg.string({ required: true }), folderId: t.arg.string({ required: false }), position: t.arg.float({ required: true }), spaceId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        const newParentPath = await listService.parentPath(a.spaceId, a.folderId ?? null);
        if (!newParentPath) throw new GraphQLError('Parent not found', { extensions: { code: 'NOT_FOUND' } });
        const list = await listService.move(a.id, a.folderId ?? null, a.position, newParentPath);
        pubsub.publish('list:updated', { spaceId: a.spaceId, list });
        return mapListRow(list);
      },
    }),
    deleteList: t.field({
      type: ListType,
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        const list = await listService.delete(a.id);
        pubsub.publish('list:updated', { spaceId: (list as any).SpaceId, list });
        return mapListRow(list);
      },
    }),
  }));
}
