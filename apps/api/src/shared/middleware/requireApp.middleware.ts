import type { Context, Next } from 'hono';
import { appService, type ScopeNode } from '../../modules/apps/app.service.js';
import { resolveAppEnabled } from '../../modules/apps/app-registry.js';
import type { AppKey } from '@projectflow/types';

/** Resolve the scope node a route's app gate applies to. Default: the task at
 *  route param `:id`. Return null to fail-closed (404). */
export type ScopeResolver = (c: Context) => Promise<ScopeNode | null>;

const taskScopeFromParam: ScopeResolver = (c) => appService.scopeNodeForTask(c.req.param('id')!);

/**
 * Gate a route on whether an app is ENABLED for the resolved scope. ORTHOGONAL
 * to requirePermission: a disabled app is a 404 feature-absent (the feature does
 * not exist here), NOT a 403. Place this BEFORE requirePermission so a disabled
 * feature short-circuits before any permission work. The resolved chain is cached
 * on the Hono context (one SP call per scope per request), mirroring how
 * loadPermissions caches the permission set.
 */
export function requireApp(appKey: AppKey, resolveScope: ScopeResolver = taskScopeFromParam) {
  return async (c: Context, next: Next) => {
    const scope = await resolveScope(c);
    if (!scope) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Resource not found', statusCode: 404 } }, 404);
    }
    const cacheKey = `appChain:${scope.scopeType}:${scope.scopeId ?? 'ws'}`;
    let chain = (c as any).get(cacheKey) as Awaited<ReturnType<typeof appService.chainForScope>> | undefined;
    if (chain === undefined) {
      chain = await appService.chainForScope(scope);
      (c as any).set(cacheKey, chain);
    }
    const { enabled } = resolveAppEnabled(appKey, chain);
    if (!enabled) {
      return c.json(
        { error: { code: 'APP_DISABLED', message: `Feature '${appKey}' is not enabled here`, statusCode: 404 } },
        404,
      );
    }
    await next();
  };
}
