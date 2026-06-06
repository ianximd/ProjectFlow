import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import {
  templateService, TemplateSourceNotFoundError,
  TemplateNotFoundError, TemplateTargetNotFoundError, TemplateWorkspaceMismatchError,
} from '../modules/templates/template.service.js';
import { TemplateApplyError } from '../modules/templates/template.apply.js';
import { roleService } from '../modules/roles/role.service.js';
import { notFound, requireObjectLevel, requireWorkspacePermission, requireAuth } from './authz.js';
import type { GQLContext } from './context.js';
import type { Template, TemplateScopeType } from '@projectflow/types';

const SCOPE_TYPES: readonly TemplateScopeType[] = ['TASK', 'LIST', 'FOLDER', 'SPACE'];

/** Validate a scopeType arg at the resolver boundary (clean BAD_REQUEST). */
function assertScopeType(s: string): TemplateScopeType {
  if (!(SCOPE_TYPES as readonly string[]).includes(s)) {
    throw new GraphQLError(`Invalid scopeType '${s}' (expected one of: ${SCOPE_TYPES.join(', ')})`, { extensions: { code: 'BAD_REQUEST' } });
  }
  return s as TemplateScopeType;
}

/** VIEW on the source node (SPACE/FOLDER/LIST directly; TASK via its list). */
async function authzCaptureSource(ctx: GQLContext, scopeType: TemplateScopeType, sourceId: string): Promise<void> {
  if (scopeType === 'TASK') {
    const workspaceId = await templateService.resolveWorkspaceId('TASK', sourceId);
    if (!workspaceId) notFound('Task not found');
    await requireObjectLevel(ctx, 'LIST', await templateService.taskListId(sourceId), 'VIEW');
    return;
  }
  await requireObjectLevel(ctx, scopeType, sourceId, 'VIEW');
}

interface ApplyResultShape {
  rootId: string;
  counts: { lists: number; tasks: number; views: number; fields: number };
}

export function registerTemplatesGraphql(): void {
  // Snapshot is transported as a JSON string (mirrors SavedView.config /
  // TaskRecurrence.rule) — keeps the schema flat over the deep subtree.
  const TemplateType = builder.objectRef<Template>('Template');

  // The apply result: the created root id + per-kind counts.
  const ApplyCountsType = builder.objectRef<ApplyResultShape['counts']>('TemplateApplyCounts');
  ApplyCountsType.implement({ fields: (t) => ({
    lists:  t.exposeInt('lists'),
    tasks:  t.exposeInt('tasks'),
    views:  t.exposeInt('views'),
    fields: t.exposeInt('fields'),
  }) });
  const ApplyResultType = builder.objectRef<ApplyResultShape>('TemplateApplyResult');
  ApplyResultType.implement({ fields: (t) => ({
    rootId: t.exposeString('rootId'),
    counts: t.field({ type: ApplyCountsType, resolve: (r) => r.counts }),
  }) });
  TemplateType.implement({ fields: (t) => ({
    id:          t.exposeString('id'),
    workspaceId: t.exposeString('workspaceId'),
    scopeType:   t.exposeString('scopeType'),
    name:        t.exposeString('name'),
    description: t.string({ nullable: true, resolve: (r) => r.description ?? null }),
    createdById: t.exposeString('createdById'),
    createdAt:   t.string({ resolve: (r) => r.createdAt }),
    // Snapshot is fetched lazily (it can be large) and only when selected.
    snapshot:    t.string({ nullable: true, resolve: (r) => templateService.getSnapshotJson(r.id) }),
  }) });

  builder.queryFields((t) => ({
    templates: t.field({
      type: [TemplateType],
      args: {
        workspaceId: t.arg.string({ required: true }),
        scopeType:   t.arg.string({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, 'workspace.read');
        const scope = a.scopeType ? assertScopeType(a.scopeType) : null;
        return templateService.list(a.workspaceId, scope);
      },
    }),
    template: t.field({
      type: TemplateType,
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const tpl = await templateService.getById(a.id);
        if (!tpl) notFound('Template not found');
        await requireWorkspacePermission(ctx, tpl!.workspaceId, 'workspace.read');
        return tpl;
      },
    }),
  }));

  builder.mutationFields((t) => ({
    createTemplate: t.field({
      type: TemplateType,
      args: {
        scopeType:   t.arg.string({ required: true }),
        sourceId:    t.arg.string({ required: true }),
        name:        t.arg.string({ required: true }),
        description: t.arg.string({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        const scope = assertScopeType(a.scopeType);
        await authzCaptureSource(ctx, scope, a.sourceId);
        try {
          return await templateService.captureTemplate(scope, a.sourceId, a.name, a.description ?? null, ctx.user!.userId);
        } catch (err) {
          if (err instanceof TemplateSourceNotFoundError)
            throw new GraphQLError(err.message, { extensions: { code: 'NOT_FOUND' } });
          throw err;
        }
      },
    }),
    applyTemplate: t.field({
      type: ApplyResultType,
      args: {
        id:              t.arg.string({ required: true }),
        targetParentId:  t.arg.string({ required: true }),
        anchorDate:      t.arg.string({ required: true }),
        selectedItemIds: t.arg.stringList({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        const tpl = await templateService.getById(a.id);
        if (!tpl) notFound('Template not found');

        // Scope-dependent create authz at the target (mirrors REST).
        if (tpl!.scopeType === 'SPACE') {
          await requireWorkspacePermission(ctx, a.targetParentId, 'project.create');
        } else if (tpl!.scopeType === 'TASK') {
          await requireObjectLevel(ctx, 'LIST', a.targetParentId, 'EDIT');
        } else {
          const objType = await templateService.resolveContainerTargetType(a.targetParentId);
          if (!objType) notFound('Apply target not found');
          await requireObjectLevel(ctx, objType, a.targetParentId, 'EDIT');
        }

        try {
          return await templateService.apply(a.id, {
            targetParentId: a.targetParentId,
            anchorDate: a.anchorDate,
            selectedItemIds: a.selectedItemIds ?? undefined,
          }, ctx.user!.userId);
        } catch (err) {
          if (err instanceof TemplateNotFoundError || err instanceof TemplateTargetNotFoundError || err instanceof TemplateWorkspaceMismatchError)
            throw new GraphQLError(err.message, { extensions: { code: 'NOT_FOUND' } });
          if (err instanceof TemplateApplyError)
            throw new GraphQLError(err.message, { extensions: { code: 'BAD_REQUEST' } });
          throw err;
        }
      },
    }),
    deleteTemplate: t.field({
      type: 'Boolean',
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        const tpl = await templateService.getById(a.id);
        if (!tpl) notFound('Template not found');
        // Creator OR workspace admin (admin.workspaces.* slug).
        let allowed = tpl!.createdById === ctx.user!.userId;
        if (!allowed) {
          const perms = await roleService.getUserPermissionSlugs(ctx.user!.userId, tpl!.workspaceId);
          allowed = [...perms].some((p) => p.startsWith('admin.workspaces.'));
        }
        if (!allowed) throw new GraphQLError('Only the creator or a workspace admin may delete this template', { extensions: { code: 'FORBIDDEN' } });
        const deleted = await templateService.delete(a.id);
        return !!deleted;
      },
    }),
  }));
}
