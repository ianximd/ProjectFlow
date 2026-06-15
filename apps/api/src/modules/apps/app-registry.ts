import type { AppKey, AppRegistryEntry, AppScopeType, ResolvedApp } from '@projectflow/types';

/**
 * The default-on registry. AppsEnabled stores ONLY overrides; this is the
 * source of truth for defaults + which scopes may override each app. Every app
 * here is gated by requireApp(key) somewhere in the API.
 *
 * `label` is the i18n key suffix under the AppCenter.apps namespace.
 */
export const APP_REGISTRY: readonly AppRegistryEntry[] = [
  { key: 'time_tracking',           label: 'time_tracking',           defaultEnabled: true,  overridableScopes: ['workspace', 'space', 'folder', 'list'] },
  { key: 'multiple_assignees',      label: 'multiple_assignees',      defaultEnabled: true,  overridableScopes: ['workspace', 'space'] },
  { key: 'sprint_points',           label: 'sprint_points',           defaultEnabled: true,  overridableScopes: ['workspace', 'space'] },
  { key: 'nested_subtasks',         label: 'nested_subtasks',         defaultEnabled: true,  overridableScopes: ['workspace', 'space', 'folder', 'list'] },
  { key: 'dependency_warning',      label: 'dependency_warning',      defaultEnabled: true,  overridableScopes: ['workspace', 'space'] },
  { key: 'reschedule_dependencies', label: 'reschedule_dependencies', defaultEnabled: true,  overridableScopes: ['workspace', 'space'] },
  { key: 'custom_task_ids',         label: 'custom_task_ids',         defaultEnabled: false, overridableScopes: ['workspace'] },
  { key: 'email',                   label: 'email',                   defaultEnabled: true,  overridableScopes: ['workspace'] },
] as const;

const REGISTRY_BY_KEY = new Map<AppKey, AppRegistryEntry>(APP_REGISTRY.map((e) => [e.key, e]));

/** One override row as usp_AppsEnabled_ListForScope returns it (camelCased). */
export interface OverrideRow {
  appKey:    AppKey;
  enabled:   boolean;
  scopeType: AppScopeType;
  scopeId:   string | null;
  depth:     number;        // higher = more specific (workspace=0 … list=9999)
}

/**
 * Most-specific-wins resolution for one app key over an ancestry override chain.
 * The chain is the (possibly empty) set of overrides on any ancestor of the
 * scope, for ANY app; we filter to `key` and pick the deepest. Unknown keys (not
 * in the registry) fail closed (disabled).
 */
export function resolveAppEnabled(key: AppKey, chain: OverrideRow[]): ResolvedApp {
  const entry = REGISTRY_BY_KEY.get(key);
  if (!entry) return { key, enabled: false, overridden: false, source: null };

  let winner: OverrideRow | null = null;
  for (const row of chain) {
    if (row.appKey !== key) continue;
    if (winner === null || row.depth > winner.depth) winner = row;
  }

  if (winner) return { key, enabled: winner.enabled, overridden: true, source: winner.scopeType };
  return { key, enabled: entry.defaultEnabled, overridden: false, source: null };
}

/** Resolve every registry app for a scope's override chain (for the frontend). */
export function resolveAllApps(chain: OverrideRow[]): ResolvedApp[] {
  return APP_REGISTRY.map((e) => resolveAppEnabled(e.key, chain));
}
