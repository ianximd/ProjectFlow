import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { templateService, TemplateSourceNotFoundError } from '../modules/templates/template.service.js';
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

export function registerTemplatesGraphql(): void {
  // Snapshot is transported as a JSON string (mirrors SavedView.config /
  // TaskRecurrence.rule) — keeps the schema flat over the deep subtree.
  const TemplateType = builder.objectRef<Template>('Template');
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
