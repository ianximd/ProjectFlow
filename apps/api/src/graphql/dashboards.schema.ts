import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { dashboardService } from '../modules/dashboards/dashboard.service.js';
import { cardService } from '../modules/dashboards/card.service.js';
import { DashboardRepository } from '../modules/dashboards/dashboard.repository.js';
import { notFound, requireAuth, requireObjectLevel, requireWorkspacePermission } from './authz.js';
import type { GQLContext } from './context.js';
import type { Dashboard, DashboardCard, CardData, DashboardScopeType, HierarchyNodeType } from '@projectflow/types';

const repo = new DashboardRepository();

/** Map a dashboard scope type to the hierarchy node type for requireObjectLevel,
 *  or null when the scope is workspace-level (gated by RBAC instead). */
function authzNode(scopeType: DashboardScopeType): HierarchyNodeType | null {
  if (scopeType === 'workspace') return null;
  return scopeType.toUpperCase() as HierarchyNodeType;
}

export function registerDashboardsGraphql(): void {
  const LayoutType = builder.objectRef<{ x: number; y: number; w: number; h: number }>('DashboardCardLayout');
  LayoutType.implement({ fields: (t) => ({
    x: t.exposeInt('x'), y: t.exposeInt('y'), w: t.exposeInt('w'), h: t.exposeInt('h'),
  }) });

  const CardType = builder.objectRef<DashboardCard>('DashboardCard');
  CardType.implement({ fields: (t) => ({
    id:          t.exposeString('id'),
    dashboardId: t.exposeString('dashboardId'),
    type:        t.exposeString('type'),
    title:       t.string({ nullable: true, resolve: (c) => c.title ?? null }),
    config:      t.string({ resolve: (c) => JSON.stringify(c.config) }),
    layout:      t.field({ type: LayoutType, resolve: (c) => c.layout }),
    position:    t.exposeFloat('position'),
  }) });

  const DashboardType = builder.objectRef<Dashboard>('Dashboard');
  DashboardType.implement({ fields: (t) => ({
    id:          t.exposeString('id'),
    workspaceId: t.exposeString('workspaceId'),
    ownerId:     t.exposeString('ownerId'),
    scopeType:   t.exposeString('scopeType'),
    scopeId:     t.string({ nullable: true, resolve: (d) => d.scopeId ?? null }),
    name:        t.exposeString('name'),
    description: t.string({ nullable: true, resolve: (d) => d.description ?? null }),
    visibility:  t.exposeString('visibility'),
    isDefault:   t.exposeBoolean('isDefault'),
    position:    t.exposeFloat('position'),
    cards:       t.field({ type: [CardType], nullable: true, resolve: (d) => d.cards ?? null }),
  }) });

  const CardDataType = builder.objectRef<CardData>('CardData');
  CardDataType.implement({ fields: (t) => ({
    cardId: t.exposeString('cardId'),
    type:   t.exposeString('type'),
    shape:  t.exposeString('shape'),
    total:  t.int({ nullable: true, resolve: (d) => d.total ?? null }),
    data:   t.string({ resolve: (d) => JSON.stringify(d.data) }),
  }) });

  builder.queryFields((t) => ({
    dashboards: t.field({
      type: [DashboardType],
      args: {
        scopeType:   t.arg.string({ required: true }),
        scopeId:     t.arg.string({ required: false }),
        workspaceId: t.arg.string({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        const scopeType = a.scopeType as DashboardScopeType;
        const node = authzNode(scopeType);
        if (node) {
          await requireObjectLevel(ctx as GQLContext, node, a.scopeId, 'VIEW');
        } else {
          await requireWorkspacePermission(ctx as GQLContext, a.workspaceId, 'workspace.read');
        }
        return dashboardService.list(
          (ctx.user as any).userId, scopeType, a.scopeId ?? null, a.workspaceId ?? undefined,
        );
      },
    }),

    dashboard: t.field({
      type: DashboardType,
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        const d = await dashboardService.getOrThrow(a.id);
        const node = authzNode(d.scopeType);
        if (node) {
          await requireObjectLevel(ctx as GQLContext, node, d.scopeId, 'VIEW');
        } else {
          await requireWorkspacePermission(ctx as GQLContext, d.workspaceId, 'workspace.read');
        }
        return dashboardService.getWithCards(a.id);
      },
    }),

    dashboardCardData: t.field({
      type: CardDataType,
      args: { cardId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        const card = await repo.getCard(a.cardId);
        if (!card) notFound('Card not found');
        const dashboard = await dashboardService.getOrThrow(card.dashboardId);
        const node = authzNode(dashboard.scopeType);
        if (node) {
          await requireObjectLevel(ctx as GQLContext, node, dashboard.scopeId, 'VIEW');
        } else {
          await requireWorkspacePermission(ctx as GQLContext, dashboard.workspaceId, 'workspace.read');
        }
        return cardService.resolve(card, dashboard, (ctx.user as any).userId);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    createDashboard: t.field({
      type: DashboardType,
      args: {
        scopeType:   t.arg.string({ required: true }),
        scopeId:     t.arg.string({ required: false }),
        name:        t.arg.string({ required: true }),
        visibility:  t.arg.string({ required: false }),
        workspaceId: t.arg.string({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        const scopeType = a.scopeType as DashboardScopeType;
        const node = authzNode(scopeType);
        if (node) {
          await requireObjectLevel(ctx as GQLContext, node, a.scopeId, 'EDIT');
        } else {
          await requireWorkspacePermission(ctx as GQLContext, a.workspaceId, 'dashboard.create');
        }
        return dashboardService.create((ctx.user as any).userId, {
          scopeType, scopeId: a.scopeId ?? null, name: a.name,
          visibility: (a.visibility as any) ?? undefined,
          workspaceId: a.workspaceId ?? undefined,
        });
      },
    }),

    updateDashboard: t.field({
      type: DashboardType,
      args: {
        id:         t.arg.string({ required: true }),
        name:       t.arg.string({ required: false }),
        visibility: t.arg.string({ required: false }),
        position:   t.arg.float({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        const d = await dashboardService.getOrThrow(a.id);
        const node = authzNode(d.scopeType);
        if (node) {
          await requireObjectLevel(ctx as GQLContext, node, d.scopeId, 'EDIT');
        } else {
          await requireWorkspacePermission(ctx as GQLContext, d.workspaceId, 'dashboard.update');
        }
        return dashboardService.update(a.id, {
          name: a.name ?? undefined,
          visibility: (a.visibility as any) ?? undefined,
          position: a.position ?? undefined,
        });
      },
    }),

    deleteDashboard: t.field({
      type: 'Boolean',
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        const d = await dashboardService.getOrThrow(a.id);
        const node = authzNode(d.scopeType);
        if (node) {
          await requireObjectLevel(ctx as GQLContext, node, d.scopeId, 'EDIT');
        } else {
          await requireWorkspacePermission(ctx as GQLContext, d.workspaceId, 'dashboard.delete');
        }
        await dashboardService.delete(a.id);
        return true;
      },
    }),

    createDashboardCard: t.field({
      type: CardType,
      args: {
        dashboardId: t.arg.string({ required: true }),
        type:        t.arg.string({ required: true }),
        title:       t.arg.string({ required: false }),
        config:      t.arg.string({ required: true }),
        layout:      t.arg.string({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        const d = await dashboardService.getOrThrow(a.dashboardId);
        const node = authzNode(d.scopeType);
        if (node) {
          await requireObjectLevel(ctx as GQLContext, node, d.scopeId, 'EDIT');
        } else {
          await requireWorkspacePermission(ctx as GQLContext, d.workspaceId, 'dashboard.update');
        }
        return dashboardService.createCard(a.dashboardId, {
          type: a.type as any,
          title: a.title ?? null,
          config: JSON.parse(a.config),
          layout: JSON.parse(a.layout),
        });
      },
    }),

    setDefaultDashboard: t.field({
      type: DashboardType,
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        const d = await dashboardService.getOrThrow(a.id);
        const node = authzNode(d.scopeType);
        if (node) {
          await requireObjectLevel(ctx as GQLContext, node, d.scopeId, 'EDIT');
        } else {
          await requireWorkspacePermission(ctx as GQLContext, d.workspaceId, 'dashboard.update');
        }
        return dashboardService.setDefault(a.id);
      },
    }),
  }));
}
