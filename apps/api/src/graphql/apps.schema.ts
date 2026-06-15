import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { appService, type ScopeNode } from '../modules/apps/app.service.js';
import { APP_REGISTRY, resolveAppEnabled } from '../modules/apps/app-registry.js';
import { ProjectRepository } from '../modules/projects/project.repository.js';
import { FolderRepository } from '../modules/hierarchy/folder.repository.js';
import { ListRepository } from '../modules/hierarchy/list.repository.js';
import { notFound, requireObjectLevel, requireWorkspacePermission } from './authz.js';
import type { AppKey, AppScopeType, ResolvedApp } from '@projectflow/types';

const projectRepo = new ProjectRepository();
const folderRepo  = new FolderRepository();
const listRepo    = new ListRepository();

// Sub-workspace scopes map to hierarchy node types for the object-level FULL gate.
const OBJECT_TYPE: Record<Exclude<AppScopeType, 'workspace'>, 'SPACE' | 'FOLDER' | 'LIST'> = {
  space:  'SPACE',
  folder: 'FOLDER',
  list:   'LIST',
};

/**
 * Resolve a scope's owning workspace, building the ScopeNode the appService takes.
 * A workspace scope carries its own id; sub-workspace scopes resolve the workspace
 * via the matching repository. Returns null for an unresolvable scope (→ 404).
 */
async function scopeNode(scopeType: AppScopeType, scopeId: string | null): Promise<ScopeNode | null> {
  if (scopeType === 'workspace') return scopeId ? { workspaceId: scopeId, scopeType, scopeId: null } : null;
  if (!scopeId) return null;
  const workspaceId =
    scopeType === 'space'  ? await projectRepo.getWorkspaceId(scopeId) :
    scopeType === 'folder' ? await folderRepo.getWorkspaceId(scopeId)  :
                             await listRepo.getWorkspaceId(scopeId);
  return workspaceId ? { workspaceId, scopeType, scopeId } : null;
}

/**
 * GraphQL equivalent of requireApp: throw a feature-absent error (code APP_DISABLED)
 * when an app is disabled for a scope. Orthogonal to a FORBIDDEN permission error.
 * Call it in a gated feature's resolver (e.g. the worklog mirror). A null scope
 * (unresolvable task/scope) reads as NOT_FOUND, fail-closed.
 */
export async function assertAppEnabled(appKey: AppKey, scope: ScopeNode | null): Promise<void> {
  if (!scope) notFound('Resource not found');
  const chain = await appService.chainForScope(scope);
  if (!resolveAppEnabled(appKey, chain).enabled) {
    throw new GraphQLError(`Feature '${appKey}' is not enabled here`, { extensions: { code: 'APP_DISABLED' } });
  }
}

/**
 * GraphQL mirror of the /apps REST surface (Phase 10a — Apps / Feature Toggles).
 * REST stays primary; both delegate to the SAME appService. The `appToggles`
 * query reads with `workspace.read`; `setAppToggle` writes with `app.manage`
 * (RBAC) AND, for sub-workspace scopes, FULL on the scope object — mirroring the
 * REST routes (app.routes.ts).
 */
export function registerAppsGraphql(): void {
  // `key`/`source` are union-typed (AppKey / AppScopeType|null), which exposeString
  // rejects — project them through t.string with an explicit resolver (mirrors the
  // WorkLog.source pattern in worklog.schema.ts).
  const ResolvedAppType = builder.objectRef<ResolvedApp>('AppToggle');
  ResolvedAppType.implement({ fields: (t) => ({
    key:        t.string({ resolve: (a) => a.key }),
    enabled:    t.boolean({ resolve: (a) => a.enabled }),
    overridden: t.boolean({ resolve: (a) => a.overridden }),
    source:     t.string({ nullable: true, resolve: (a) => a.source ?? null }),
  }) });

  builder.queryFields((t) => ({
    /** The resolved feature set for a scope (workspace.read on the scope's workspace). */
    appToggles: t.field({
      type: [ResolvedAppType],
      args: { scopeType: t.arg.string({ required: true }), scopeId: t.arg.string({ required: false }) },
      resolve: async (_, a, ctx) => {
        const scope = await scopeNode(a.scopeType as AppScopeType, a.scopeId ?? null);
        if (!scope) notFound('Scope not found');
        await requireWorkspacePermission(ctx, scope.workspaceId, 'workspace.read');
        return appService.resolveAll(scope);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    /** Write/clear an app override for a scope (app.manage + FULL on sub-workspace scopes). */
    setAppToggle: t.field({
      type: 'Boolean',
      args: {
        scopeType: t.arg.string({ required: true }),
        scopeId:   t.arg.string({ required: false }),
        appKey:    t.arg.string({ required: true }),
        enabled:   t.arg.boolean({ required: false }), // null/omitted clears the override
      },
      resolve: async (_, a, ctx) => {
        // The registry is the authority for the key space + which scopes may
        // override each app (parity with the REST PATCH validation).
        const entry = APP_REGISTRY.find((e) => e.key === a.appKey);
        if (!entry) throw new GraphQLError(`Unknown app key '${a.appKey}'`, { extensions: { code: 'BAD_USER_INPUT' } });
        const scope = await scopeNode(a.scopeType as AppScopeType, a.scopeId ?? null);
        if (!scope) notFound('Scope not found');
        if (!entry.overridableScopes.includes(scope.scopeType)) {
          throw new GraphQLError(`App '${a.appKey}' is not overridable at the ${scope.scopeType} scope`, { extensions: { code: 'BAD_USER_INPUT' } });
        }
        await requireWorkspacePermission(ctx, scope.workspaceId, 'app.manage');
        if (scope.scopeType !== 'workspace') {
          await requireObjectLevel(ctx, OBJECT_TYPE[scope.scopeType], scope.scopeId, 'FULL');
        }
        await appService.setToggle(scope, a.appKey as AppKey, a.enabled ?? null, (ctx.user as any).userId);
        return true;
      },
    }),
  }));
}
