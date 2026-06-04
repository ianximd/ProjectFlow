import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { TaskType, type TaskShape } from './schema.js';
import { viewService } from '../modules/views/view.service.js';
import { ViewNotFoundError, ViewValidationError } from '../modules/views/view.errors.js';
import { requireObjectLevel, requireWorkspacePermission } from './authz.js';
import { pubsub } from './pubsub.js';
import type { GQLContext } from './context.js';
import type { SavedView, ViewTaskPage, ViewConfig, HierarchyNodeType } from '@projectflow/types';

/**
 * The view scope types (LIST/FOLDER/SPACE/EVERYTHING) map 1:1 onto hierarchy
 * node types for the scoped variants. EVERYTHING is workspace-wide and has no
 * node-level ACL — returns null so callers skip requireObjectLevel.
 */
function authzNode(scopeType: string): HierarchyNodeType | null {
  return scopeType === 'EVERYTHING' ? null : (scopeType as HierarchyNodeType);
}

type ViewScopeType = 'LIST' | 'FOLDER' | 'SPACE' | 'EVERYTHING';
type ViewType = 'list' | 'board' | 'table' | 'calendar';
const SCOPE_TYPES: readonly ViewScopeType[] = ['LIST', 'FOLDER', 'SPACE', 'EVERYTHING'];
const VIEW_TYPES: readonly ViewType[] = ['list', 'board', 'table', 'calendar'];

/** Validate a scopeType arg at the resolver boundary so a bad value throws a
 * clean BAD_REQUEST instead of surfacing as a raw mssql 500 from the SP CHECK. */
function assertScopeType(s: string): ViewScopeType {
  if (!(SCOPE_TYPES as readonly string[]).includes(s)) {
    throw new GraphQLError(`Invalid scopeType '${s}' (expected one of: ${SCOPE_TYPES.join(', ')})`, { extensions: { code: 'BAD_REQUEST' } });
  }
  return s as ViewScopeType;
}

/** Validate a view type arg at the resolver boundary (see assertScopeType). */
function assertViewType(s: string): ViewType {
  if (!(VIEW_TYPES as readonly string[]).includes(s)) {
    throw new GraphQLError(`Invalid type '${s}' (expected one of: ${VIEW_TYPES.join(', ')})`, { extensions: { code: 'BAD_REQUEST' } });
  }
  return s as ViewType;
}

/**
 * Tenant guard for EVERYTHING-scoped paths. EVERYTHING views have no node-level
 * ACL, so the only valid authority is workspace membership. Mirrors the
 * workspace-scoped read resolvers (e.g. taskTypes): a non-member has no
 * permission slugs for the workspace and requireWorkspacePermission throws
 * FORBIDDEN; a missing workspaceId is a clean BAD_REQUEST.
 */
async function requireEverythingWorkspace(ctx: GQLContext, workspaceId: string | null | undefined): Promise<void> {
  if (!workspaceId) {
    throw new GraphQLError('workspaceId is required for EVERYTHING-scoped views', { extensions: { code: 'BAD_REQUEST' } });
  }
  await requireWorkspacePermission(ctx, workspaceId, 'workspace.read');
}

/**
 * `viewService.runView`/`runConfig` return raw `SELECT t.*` rows from the
 * Tasks table — PascalCase physical columns. The shared `Task` GraphQL type
 * reads camelCase (exposeString('title') etc.), so we map each row into the
 * exported `TaskShape` the Task type's field resolvers expect.
 */
function mapTaskRow(r: any): TaskShape {
  return {
    id:          r.Id,
    projectId:   r.ProjectId,
    workspaceId: r.WorkspaceId,
    issueKey:    r.IssueKey,
    title:       r.Title,
    description: r.Description ?? null,
    type:        r.Type,
    status:      r.Status,
    priority:    r.Priority,
    storyPoints: r.StoryPoints ?? null,
    sprintId:    r.SprintId ?? null,
    reporterId:  r.ReporterId,
    dueDate:     r.DueDate ?? null,
    createdAt:   r.CreatedAt,
    updatedAt:   r.UpdatedAt,
  };
}

export function registerViewsGraphql(): void {
  // ── Bulk-edit result types ─────────────────────────────────────────────────
  const BulkFailType = builder.objectRef<{ id: string; reason: string }>('BulkUpdateFailure');
  BulkFailType.implement({
    fields: (t) => ({
      id:     t.exposeString('id'),
      reason: t.exposeString('reason'),
    }),
  });

  const BulkResultType = builder.objectRef<{ updated: string[]; failed: Array<{ id: string; reason: string }> }>('BulkUpdateResult');
  BulkResultType.implement({
    fields: (t) => ({
      updated: t.exposeStringList('updated'),
      failed:  t.field({ type: [BulkFailType], resolve: (r) => r.failed }),
    }),
  });

  const SavedViewType = builder.objectRef<SavedView>('SavedView');
  SavedViewType.implement({ fields: (t) => ({
    id:          t.exposeString('id'),
    workspaceId: t.exposeString('workspaceId'),
    ownerId:     t.exposeString('ownerId'),
    scopeType:   t.exposeString('scopeType'),
    scopeId:     t.string({ nullable: true, resolve: (v) => v.scopeId }),
    type:        t.exposeString('type'),
    name:        t.exposeString('name'),
    isShared:    t.exposeBoolean('isShared'),
    isDefault:   t.exposeBoolean('isDefault'),
    position:    t.exposeFloat('position'),
    config:      t.string({ resolve: (v) => JSON.stringify(v.config) }),
  }) });

  const ViewGroupType = builder.objectRef<{ key: string; label: string; count: number }>('ViewGroup');
  ViewGroupType.implement({ fields: (t) => ({
    key:   t.exposeString('key'),
    label: t.exposeString('label'),
    count: t.exposeInt('count'),
  }) });

  const ViewTaskPageType = builder.objectRef<ViewTaskPage>('ViewTaskPage');
  ViewTaskPageType.implement({ fields: (t) => ({
    total:  t.exposeInt('total'),
    groups: t.field({ type: [ViewGroupType], nullable: true, resolve: (p) => p.groups ?? null }),
    tasks:  t.field({ type: [TaskType], resolve: (p) => (p.tasks as any[]).map(mapTaskRow) as any }),
  }) });

  const CreateInput = builder.inputType('CreateSavedViewInput', { fields: (t) => ({
    scopeType:   t.string({ required: true }),
    scopeId:     t.string({ required: false }),
    type:        t.string({ required: true }),
    name:        t.string({ required: true }),
    isShared:    t.boolean({ required: true }),
    isDefault:   t.boolean({ required: true }),
    config:      t.string({ required: true }),
    workspaceId: t.string({ required: false }),
  }) });

  const UpdateInput = builder.inputType('UpdateSavedViewInput', { fields: (t) => ({
    name:      t.string({ required: false }),
    isShared:  t.boolean({ required: false }),
    isDefault: t.boolean({ required: false }),
    config:    t.string({ required: false }),
  }) });

  builder.queryFields((t) => ({
    savedViews: t.field({
      type: [SavedViewType],
      args: { scopeType: t.arg.string({ required: true }), scopeId: t.arg.string({ required: false }), workspaceId: t.arg.string({ required: false }) },
      resolve: async (_, a, ctx) => {
        const userId = requireUser(ctx);
        const scopeType = assertScopeType(a.scopeType);
        const node = authzNode(scopeType);
        if (node) await requireObjectLevel(ctx, node, a.scopeId, 'VIEW');
        else await requireEverythingWorkspace(ctx, a.workspaceId);
        return viewService.list(userId, scopeType, a.scopeId ?? null, a.workspaceId ?? undefined);
      },
    }),
    viewTasks: t.field({
      type: ViewTaskPageType,
      args: { viewId: t.arg.string({ required: true }), page: t.arg.int({ required: false }), meMode: t.arg.boolean({ required: false }) },
      resolve: async (_, a, ctx) => {
        const userId = requireUser(ctx);
        const view = await viewService.getOrThrow(a.viewId);
        const node = authzNode(view.scopeType);
        if (node) await requireObjectLevel(ctx, node, view.scopeId, 'VIEW');
        else await requireEverythingWorkspace(ctx, view.workspaceId);
        return viewService.runView(userId, a.viewId, { page: a.page ?? 1, meMode: a.meMode ?? undefined });
      },
    }),
    previewViewTasks: t.field({
      type: ViewTaskPageType,
      args: {
        scopeType: t.arg.string({ required: true }), scopeId: t.arg.string({ required: false }),
        config: t.arg.string({ required: true }), page: t.arg.int({ required: false }),
        meMode: t.arg.boolean({ required: false }), workspaceId: t.arg.string({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        const userId = requireUser(ctx);
        const scopeType = assertScopeType(a.scopeType);
        const node = authzNode(scopeType);
        if (node) await requireObjectLevel(ctx, node, a.scopeId, 'VIEW');
        else await requireEverythingWorkspace(ctx, a.workspaceId);
        let config: ViewConfig;
        try { config = JSON.parse(a.config) as ViewConfig; }
        catch { throw new GraphQLError('Invalid config JSON', { extensions: { code: 'VIEW_VALIDATION' } }); }
        try {
          return await viewService.runConfig(scopeType, a.scopeId ?? null, config, { page: a.page ?? 1, meMode: a.meMode ?? undefined }, a.workspaceId ?? undefined, userId);
        } catch (e) { throw toGraphqlError(e); }
      },
    }),
  }));

  builder.mutationFields((t) => ({
    createSavedView: t.field({
      type: SavedViewType,
      args: { input: t.arg({ type: CreateInput, required: true }) },
      resolve: async (_, a, ctx) => {
        const userId = requireUser(ctx);
        const scopeType = assertScopeType(a.input.scopeType);
        const type = assertViewType(a.input.type);
        const node = authzNode(scopeType);
        if (node) await requireObjectLevel(ctx, node, a.input.scopeId, 'EDIT');
        else await requireEverythingWorkspace(ctx, a.input.workspaceId);
        let config: ViewConfig;
        try { config = JSON.parse(a.input.config) as ViewConfig; }
        catch { throw new GraphQLError('Invalid config JSON', { extensions: { code: 'VIEW_VALIDATION' } }); }
        try {
          const v = await viewService.create(userId, {
            scopeType, scopeId: a.input.scopeId ?? null, type,
            name: a.input.name, isShared: a.input.isShared, isDefault: a.input.isDefault,
            config, workspaceId: a.input.workspaceId ?? undefined,
          });
          pubsub.publish('savedView:updated', { scopeType: v.scopeType, scopeId: v.scopeId });
          return v;
        } catch (e) { throw toGraphqlError(e); }
      },
    }),
    updateSavedView: t.field({
      type: SavedViewType,
      args: { id: t.arg.string({ required: true }), input: t.arg({ type: UpdateInput, required: true }) },
      resolve: async (_, a, ctx) => {
        await requireOwnerOrNodeEdit(ctx, a.id);
        let config: ViewConfig | undefined;
        if (a.input.config != null) {
          try { config = JSON.parse(a.input.config) as ViewConfig; }
          catch { throw new GraphQLError('Invalid config JSON', { extensions: { code: 'VIEW_VALIDATION' } }); }
        }
        try {
          const v = await viewService.update(a.id, {
            name: a.input.name ?? undefined, isShared: a.input.isShared ?? undefined,
            isDefault: a.input.isDefault ?? undefined, config,
          });
          pubsub.publish('savedView:updated', { scopeType: v.scopeType, scopeId: v.scopeId });
          return v;
        } catch (e) { throw toGraphqlError(e); }
      },
    }),
    deleteSavedView: t.field({
      type: SavedViewType,
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireOwnerOrNodeEdit(ctx, a.id);
        try {
          const v = await viewService.delete(a.id);
          pubsub.publish('savedView:updated', { scopeType: v.scopeType, scopeId: v.scopeId });
          return v;
        } catch (e) { throw toGraphqlError(e); }
      },
    }),
    reorderSavedView: t.field({
      type: SavedViewType,
      args: { id: t.arg.string({ required: true }), position: t.arg.float({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireOwnerOrNodeEdit(ctx, a.id);
        try { return await viewService.reorder(a.id, a.position); }
        catch (e) { throw toGraphqlError(e); }
      },
    }),
    bulkUpdateTasks: t.field({
      type: BulkResultType,
      args: {
        taskIds: t.arg.stringList({ required: true }),
        action:  t.arg.string({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        const userId = requireUser(ctx);
        let parsedAction: unknown;
        try { parsedAction = JSON.parse(a.action); }
        catch {
          throw new GraphQLError('Invalid action JSON', { extensions: { code: 'BAD_REQUEST' } });
        }
        return viewService.bulkUpdate(userId, { taskIds: a.taskIds, action: parsedAction as any });
      },
    }),
  }));
}

function requireUser(ctx: GQLContext): string {
  if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
  return ctx.user.userId;
}

function toGraphqlError(e: unknown): GraphQLError {
  if (e instanceof GraphQLError) return e;
  if (e instanceof ViewValidationError) return new GraphQLError(e.message, { extensions: { code: 'VIEW_VALIDATION' } });
  if (e instanceof ViewNotFoundError) return new GraphQLError(e.message, { extensions: { code: 'NOT_FOUND' } });
  return new GraphQLError('Internal server error', { extensions: { code: 'INTERNAL_SERVER_ERROR' } });
}

/**
 * Mutating a view requires being its owner OR holding EDIT on its scope node.
 * usp_View_GetById does NOT filter by workspace, so this lookup-then-authz
 * step is the tenant guard: a non-member's requireObjectLevel will throw
 * FORBIDDEN/NOT_FOUND. EVERYTHING-scoped views fall back to owner-only for v1.
 */
async function requireOwnerOrNodeEdit(ctx: GQLContext, id: string): Promise<void> {
  if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
  let v: SavedView;
  try { v = await viewService.getOrThrow(id); }
  catch (e) { throw toGraphqlError(e); }
  if (v.ownerId === ctx.user.userId) return;
  if (v.scopeType !== 'EVERYTHING') {
    await requireObjectLevel(ctx, v.scopeType as HierarchyNodeType, v.scopeId, 'EDIT');
  } else {
    throw new GraphQLError('You do not have access', { extensions: { code: 'FORBIDDEN' } });
  }
}
