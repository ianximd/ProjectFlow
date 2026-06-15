import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { appService, type ScopeNode } from './app.service.js';
import { APP_REGISTRY } from './app-registry.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';
import { requireObjectAccess } from '../access/access.middleware.js';
import { ListRepository } from '../hierarchy/list.repository.js';
import { FolderRepository } from '../hierarchy/folder.repository.js';
import { ProjectRepository } from '../projects/project.repository.js';
import type { AppKey, AppScopeType } from '@projectflow/types';

const listRepo    = new ListRepository();
const folderRepo  = new FolderRepository();
const projectRepo = new ProjectRepository();

const SCOPE_TYPES = ['workspace', 'space', 'folder', 'list'] as const;
const APP_KEYS = APP_REGISTRY.map((e) => e.key) as [AppKey, ...AppKey[]];

const scopeParam = z.enum(SCOPE_TYPES);
const setSchema = z.object({ enabled: z.boolean().nullable() }); // null clears the override

/** Resolve the workspace id for a scope (workspace/space/folder/list). */
async function workspaceForScope(scopeType: AppScopeType, scopeId: string | null): Promise<string | null> {
  if (scopeType === 'workspace') return scopeId;               // workspace scope: :scopeId IS the workspace id
  if (!scopeId) return null;
  if (scopeType === 'space')  return projectRepo.getWorkspaceId(scopeId);
  if (scopeType === 'folder') return folderRepo.getWorkspaceId(scopeId);
  return listRepo.getWorkspaceId(scopeId);
}

/** Build a ScopeNode from the route params; workspace scope carries scopeId=null. */
async function scopeNodeFromParams(scopeType: AppScopeType, rawScopeId: string): Promise<ScopeNode | null> {
  if (scopeType === 'workspace') return { workspaceId: rawScopeId, scopeType, scopeId: null };
  const workspaceId = await workspaceForScope(scopeType, rawScopeId);
  if (!workspaceId) return null;
  return { workspaceId, scopeType, scopeId: rawScopeId };
}

export const appRoutes = new Hono();

// GET /apps?workspaceId=&scopeType=&scopeId=  — the registry + resolved-all for a scope.
// READ-gated with workspace.read (parity with the GraphQL appToggles query; closes a
// cross-tenant read of the resolved feature set).
appRoutes.get(
  '/',
  requirePermission('workspace.read', { resolveWorkspace: (c) => Promise.resolve(c.req.query('workspaceId') ?? null) }),
  async (c) => {
    const workspaceId = c.req.query('workspaceId');
    const scopeType   = (c.req.query('scopeType') ?? 'workspace') as AppScopeType;
    const scopeId     = c.req.query('scopeId') ?? null;
    if (!workspaceId) return c.json({ error: { code: 'BAD_REQUEST', message: 'workspaceId required' } }, 400);
    if (!SCOPE_TYPES.includes(scopeType)) return c.json({ error: { code: 'BAD_REQUEST', message: 'invalid scopeType' } }, 400);
    const scope: ScopeNode = { workspaceId, scopeType, scopeId: scopeType === 'workspace' ? null : scopeId };
    const apps = await appService.resolveAll(scope);
    return c.json({ data: { registry: APP_REGISTRY, apps } });
  },
);

// GET /apps/:scopeType/:scopeId — own-scope overrides only (App Center "this scope" column).
appRoutes.get(
  '/:scopeType/:scopeId',
  requirePermission('workspace.read', {
    resolveWorkspace: (c) => {
      const st = scopeParam.safeParse(c.req.param('scopeType'));
      if (!st.success) return Promise.resolve(null);
      return workspaceForScope(st.data, c.req.param('scopeId') ?? null);
    },
  }),
  async (c) => {
    const parsed = scopeParam.safeParse(c.req.param('scopeType'));
    if (!parsed.success) return c.json({ error: { code: 'BAD_REQUEST', message: 'invalid scopeType' } }, 400);
    const scope = await scopeNodeFromParams(parsed.data, c.req.param('scopeId') ?? '');
    if (!scope) return c.json({ error: { code: 'NOT_FOUND', message: 'Scope not found' } }, 404);
    return c.json({ data: await appService.listForScope(scope) });
  },
);

// Conditional object-FULL middleware: the workspace ROOT has no hierarchy object,
// so app.manage alone gates it; space/folder/list ALSO require FULL on the object.
// (requireObjectAccess 404s on a null resolver, so we cannot let it run for the
//  workspace scope — we branch instead.)
const requireFullOnScopeObject = (c: any, next: any) => {
  const st = c.req.param('scopeType');
  if (st === 'workspace') return next();
  const map = { space: 'SPACE', folder: 'FOLDER', list: 'LIST' } as const;
  const type = map[st as keyof typeof map];
  if (!type) return c.json({ error: { code: 'BAD_REQUEST', message: 'invalid scopeType' } }, 400);
  return requireObjectAccess('FULL', (cc: any) => ({ type, id: cc.req.param('scopeId')! }))(c, next);
};

// PATCH /apps/:scopeType/:scopeId/:key  { enabled: bool|null } — write/clear an override.
// Double-gated: app.manage (RBAC) AND FULL on the object (sub-workspace scopes).
appRoutes.patch(
  '/:scopeType/:scopeId/:key',
  zValidator('json', setSchema),
  requirePermission('app.manage', {
    resolveWorkspace: (c) => {
      const st = scopeParam.safeParse(c.req.param('scopeType'));
      if (!st.success) return Promise.resolve(null);
      return workspaceForScope(st.data, c.req.param('scopeId') ?? null);
    },
  }),
  requireFullOnScopeObject,
  async (c) => {
    const parsed = scopeParam.safeParse(c.req.param('scopeType'));
    if (!parsed.success) return c.json({ error: { code: 'BAD_REQUEST', message: 'invalid scopeType' } }, 400);
    const appKey = c.req.param('key');
    if (!APP_KEYS.includes(appKey as AppKey)) return c.json({ error: { code: 'BAD_REQUEST', message: 'unknown app key' } }, 400);
    const scope = await scopeNodeFromParams(parsed.data, c.req.param('scopeId') ?? '');
    if (!scope) return c.json({ error: { code: 'NOT_FOUND', message: 'Scope not found' } }, 404);

    const user = (c as any).get('user') as any;
    const { enabled } = c.req.valid('json');
    const toggle = await appService.setToggle(scope, appKey as AppKey, enabled, user?.userId ?? null);
    // NOTE: no realtime publish — there is no client subscriber for app toggles
    // (the App Center refetches locally after its own mutation). Live cross-client
    // refresh-on-toggle is a documented deferral, not in the acceptance.
    return c.json({ data: toggle });
  },
);
