import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { WhiteboardService } from '../modules/whiteboards/whiteboard.service.js';
import { notFound, requireObjectLevel, requireWorkspacePermission } from './authz.js';
import type {
  Whiteboard, WhiteboardSummary, WhiteboardTaskLink, ConvertShapeToTaskResult,
  HierarchyNodeType, WhiteboardScopeType,
} from '@projectflow/types';

const svc = new WhiteboardService();

export function registerWhiteboardGraphql(): void {
  const WhiteboardType = builder.objectRef<Whiteboard>('Whiteboard');
  WhiteboardType.implement({ fields: (t) => ({
    id:          t.exposeString('id'),
    workspaceId: t.exposeString('workspaceId'),
    scopeType:   t.exposeString('scopeType'),
    scopeId:     t.exposeString('scopeId'),
    name:        t.exposeString('name'),
    docJson:     t.string({ nullable: true, resolve: (w) => w.docJson ?? null }),
    createdById: t.exposeString('createdById'),
    createdAt:   t.field({ type: 'Date', resolve: (w) => new Date(w.createdAt) }),
    updatedAt:   t.field({ type: 'Date', resolve: (w) => new Date(w.updatedAt) }),
  }) });

  const WhiteboardSummaryType = builder.objectRef<WhiteboardSummary>('WhiteboardSummary');
  WhiteboardSummaryType.implement({ fields: (t) => ({
    id:          t.exposeString('id'),
    workspaceId: t.exposeString('workspaceId'),
    scopeType:   t.exposeString('scopeType'),
    scopeId:     t.exposeString('scopeId'),
    name:        t.exposeString('name'),
    createdById: t.exposeString('createdById'),
    createdAt:   t.field({ type: 'Date', resolve: (w) => new Date(w.createdAt) }),
    updatedAt:   t.field({ type: 'Date', resolve: (w) => new Date(w.updatedAt) }),
  }) });

  const LinkType = builder.objectRef<WhiteboardTaskLink>('WhiteboardTaskLink');
  LinkType.implement({ fields: (t) => ({
    id:           t.exposeString('id'),
    whiteboardId: t.exposeString('whiteboardId'),
    taskId:       t.exposeString('taskId'),
    shapeId:      t.exposeString('shapeId'),
    taskTitle:    t.exposeString('taskTitle'),
    taskStatus:   t.exposeString('taskStatus'),
    taskIssueKey: t.exposeString('taskIssueKey'),
    createdAt:    t.field({ type: 'Date', resolve: (l) => new Date(l.createdAt) }),
  }) });

  const ConvertResultType = builder.objectRef<ConvertShapeToTaskResult>('ConvertShapeToTaskResult');
  ConvertResultType.implement({ fields: (t) => ({
    taskId:    t.string({ resolve: (r) => (r.task as any).id ?? (r.task as any).Id }),
    taskTitle: t.string({ resolve: (r) => (r.task as any).title ?? (r.task as any).Title }),
    link:      t.field({ type: LinkType, resolve: (r) => r.link }),
  }) });

  builder.queryFields((t) => ({
    whiteboards: t.field({
      type: [WhiteboardSummaryType],
      args: {
        workspaceId: t.arg.string({ required: true }),
        scopeType:   t.arg.string({ required: true }),
        scopeId:     t.arg.string({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        await requireObjectLevel(ctx, a.scopeType as HierarchyNodeType, a.scopeId, 'VIEW');
        return svc.listForScope(a.workspaceId, a.scopeType as WhiteboardScopeType, a.scopeId);
      },
    }),
    whiteboard: t.field({
      type: WhiteboardType,
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const wb = await svc.getById(a.id);
        if (!wb) notFound('Whiteboard not found');
        await requireObjectLevel(ctx, wb.scopeType as HierarchyNodeType, wb.scopeId, 'VIEW');
        return wb;
      },
    }),
  }));

  builder.mutationFields((t) => ({
    createWhiteboard: t.field({
      type: WhiteboardType,
      args: {
        workspaceId: t.arg.string({ required: true }),
        scopeType:   t.arg.string({ required: true }),
        scopeId:     t.arg.string({ required: true }),
        name:        t.arg.string({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        await requireObjectLevel(ctx, a.scopeType as HierarchyNodeType, a.scopeId, 'EDIT');
        // I1 guard (parity with REST POST /): re-derive the authoritative workspace
        // from the scope node — never trust the caller-supplied workspaceId.
        const resolvedWs = await svc.getScopeWorkspaceId(a.scopeType as WhiteboardScopeType, a.scopeId);
        if (!resolvedWs) notFound('Scope not found');
        if (a.workspaceId !== resolvedWs) {
          throw new GraphQLError('workspaceId does not match scope', { extensions: { code: 'WORKSPACE_MISMATCH' } });
        }
        const userId = (ctx.user as any).userId as string;
        return svc.create({
          workspaceId: resolvedWs,
          scopeType:   a.scopeType as WhiteboardScopeType,
          scopeId:     a.scopeId,
          name:        a.name,
          createdById: userId,
        });
      },
    }),
    updateWhiteboard: t.field({
      type: WhiteboardType,
      nullable: true,
      args: {
        id:   t.arg.string({ required: true }),
        name: t.arg.string({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        const wb = await svc.getById(a.id);
        if (!wb) notFound('Whiteboard not found');
        await requireObjectLevel(ctx, wb.scopeType as HierarchyNodeType, wb.scopeId, 'EDIT');
        return svc.update(a.id, a.name ?? undefined);
      },
    }),
    deleteWhiteboard: t.field({
      type: 'Boolean',
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const wb = await svc.getById(a.id);
        if (!wb) notFound('Whiteboard not found');
        await requireObjectLevel(ctx, wb.scopeType as HierarchyNodeType, wb.scopeId, 'EDIT');
        await svc.softDelete(a.id);
        return true;
      },
    }),
    convertShapeToTask: t.field({
      type: ConvertResultType,
      args: {
        whiteboardId: t.arg.string({ required: true }),
        targetListId: t.arg.string({ required: true }),
        shapeId:      t.arg.string({ required: true }),
        shapeJson:    t.arg.string({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        const wb = await svc.getById(a.whiteboardId);
        if (!wb) notFound('Whiteboard not found');
        await requireObjectLevel(ctx, wb.scopeType as HierarchyNodeType, wb.scopeId, 'VIEW');
        await requireWorkspacePermission(ctx, wb.workspaceId, 'task.create');
        await requireObjectLevel(ctx, 'LIST', a.targetListId, 'EDIT');
        let shape: any;
        try { shape = JSON.parse(a.shapeJson); }
        catch { throw new GraphQLError('shapeJson is not valid JSON', { extensions: { code: 'BAD_REQUEST' } }); }
        shape.id = a.shapeId;
        // 4-arg service signature: workspace is derived from the target list inside the service.
        return svc.convertShapeToTask(a.whiteboardId, a.targetListId, shape, (ctx.user as any).userId);
      },
    }),
  }));
}
