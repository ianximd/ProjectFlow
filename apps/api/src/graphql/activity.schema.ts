/**
 * Phase 9e — Activity feed GraphQL types and query.
 *
 * Exposes `activityFeed(scopeType, scopeId, actor, action, resource, page,
 * pageSize)` → AuditLogPage, gated with the same authz pattern as savedViews:
 *   - LIST/FOLDER/SPACE scopes → requireObjectLevel(ctx, nodeType, scopeId, 'VIEW')
 *   - EVERYTHING scope          → requireEverythingWorkspace(ctx, workspaceId)
 */

import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { requireObjectLevel, requireWorkspacePermission } from './authz.js';
import { activityService } from '../modules/activity/activity.service.js';
import type { GQLContext } from './context.js';
import type { AuditLogEntry, AuditLogPage, HierarchyNodeType } from '@projectflow/types';

// ─── Inline helpers (mirrors views.schema.ts — these are NOT exported from authz) ──

type ViewScopeType = 'LIST' | 'FOLDER' | 'SPACE' | 'EVERYTHING';
const SCOPE_TYPES: readonly ViewScopeType[] = ['LIST', 'FOLDER', 'SPACE', 'EVERYTHING'];

function requireUser(ctx: GQLContext): asserts ctx is GQLContext & { user: NonNullable<GQLContext['user']> } {
  if (!ctx.user) {
    throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
  }
}

function assertScopeType(s: string): ViewScopeType {
  if (!(SCOPE_TYPES as readonly string[]).includes(s)) {
    throw new GraphQLError(
      `Invalid scopeType '${s}' (expected one of: ${SCOPE_TYPES.join(', ')})`,
      { extensions: { code: 'BAD_REQUEST' } },
    );
  }
  return s as ViewScopeType;
}

/** Returns the HierarchyNodeType for ACL, or null for EVERYTHING (no node-level ACL). */
function authzNode(scopeType: string): HierarchyNodeType | null {
  return scopeType === 'EVERYTHING' ? null : (scopeType as HierarchyNodeType);
}

async function requireEverythingWorkspace(
  ctx: GQLContext,
  workspaceId: string | null | undefined,
): Promise<void> {
  if (!workspaceId) {
    throw new GraphQLError('workspaceId is required for EVERYTHING-scoped activity', {
      extensions: { code: 'BAD_REQUEST' },
    });
  }
  await requireWorkspacePermission(ctx, workspaceId, 'workspace.read');
}

// ─── Pothos object types ─────────────────────────────────────────────────────

const AuditLogEntryType = builder.objectRef<AuditLogEntry>('AuditLogEntry').implement({
  fields: (t) => ({
    id:          t.exposeString('id'),
    workspaceId: t.string({ nullable: true,  resolve: (e) => e.workspaceId }),
    userId:      t.exposeString('userId'),
    userEmail:   t.string({ nullable: true,  resolve: (e) => e.userEmail }),
    action:      t.exposeString('action'),
    resource:    t.exposeString('resource'),
    resourceId:  t.string({ nullable: true,  resolve: (e) => e.resourceId }),
    oldValues:   t.string({
      nullable: true,
      resolve: (e) => e.oldValues ? JSON.stringify(e.oldValues) : null,
    }),
    newValues:   t.string({
      nullable: true,
      resolve: (e) => e.newValues ? JSON.stringify(e.newValues) : null,
    }),
    ipAddress:   t.string({ nullable: true,  resolve: (e) => e.ipAddress }),
    userAgent:   t.string({ nullable: true,  resolve: (e) => e.userAgent }),
    createdAt:   t.field({ type: 'Date', resolve: (e) => new Date(e.createdAt) }),
  }),
});

const AuditLogPageType = builder.objectRef<AuditLogPage>('AuditLogPage').implement({
  fields: (t) => ({
    entries:  t.field({ type: [AuditLogEntryType], resolve: (p) => p.entries }),
    total:    t.exposeInt('total'),
    page:     t.exposeInt('page'),
    pageSize: t.exposeInt('pageSize'),
  }),
});

// ─── Query registration ──────────────────────────────────────────────────────

export function registerActivityGraphql(): void {
  builder.queryFields((t) => ({
    activityFeed: t.field({
      type:     AuditLogPageType,
      nullable: false,
      args: {
        scopeType:  t.arg.string({ required: true }),
        scopeId:    t.arg.string({ required: false }),
        workspaceId: t.arg.string({ required: false }),
        actor:      t.arg.string({ required: false }),
        action:     t.arg.string({ required: false }),
        resource:   t.arg.string({ required: false }),
        page:       t.arg.int({ required: false }),
        pageSize:   t.arg.int({ required: false }),
      },
      resolve: async (_root, args, ctx) => {
        requireUser(ctx);

        const scopeType = assertScopeType(args.scopeType);
        const scopeId   = args.scopeId ?? null;
        const node      = authzNode(scopeType);

        // Authz gate — mirrors savedViews pattern exactly
        if (node) {
          // LIST / FOLDER / SPACE: check hierarchy ACL
          await requireObjectLevel(ctx, node, scopeId, 'VIEW');
        } else {
          // EVERYTHING: workspace membership check
          await requireEverythingWorkspace(ctx, args.workspaceId ?? scopeId);
        }

        return activityService.getActivity(
          ctx.user.userId,
          scopeType,
          args.scopeId ?? null,
          args.workspaceId ?? undefined,
          {
            actor:    args.actor    ?? undefined,
            action:   args.action   ?? undefined,
            resource: args.resource ?? undefined,
            page:     args.page     ?? undefined,
            pageSize: args.pageSize ?? undefined,
          },
        );
      },
    }),

    taskActivity: t.field({
      type:     AuditLogPageType,
      nullable: false,
      args: {
        taskId:   t.arg.string({ required: true }),
        page:     t.arg.int({ required: false }),
        pageSize: t.arg.int({ required: false }),
      },
      resolve: async (_root, args, ctx) => {
        requireUser(ctx);
        return activityService.getTaskActivity(ctx.user.userId, args.taskId, {
          page:     args.page     ?? undefined,
          pageSize: args.pageSize ?? undefined,
        });
      },
    }),
  }));
}
