'use server';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';
import type { AppRegistryEntry, ResolvedApp, AppScopeType, AppKey } from '@projectflow/types';

/** Resolve the registry + the effective app set for a scope. */
export async function loadAppToggles(
  workspaceId: string, scopeType: AppScopeType, scopeId: string | null,
): Promise<ActionResult<{ registry: AppRegistryEntry[]; apps: ResolvedApp[] }>> {
  await requireSession();
  try {
    const qs = new URLSearchParams({ workspaceId, scopeType, ...(scopeId ? { scopeId } : {}) });
    // serverFetch already unwraps the { data } envelope.
    const data = await serverFetch<{ registry: AppRegistryEntry[]; apps: ResolvedApp[] }>(`/apps?${qs.toString()}`, { method: 'GET' });
    return { ok: true, data };
  } catch (e) { return toActionError(e); }
}

/** Write (enabled=true|false) or clear (enabled=null) one override for a scope. */
export async function setAppToggle(
  scopeType: AppScopeType, scopeId: string, appKey: AppKey, enabled: boolean | null,
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/apps/${scopeType}/${encodeURIComponent(scopeId)}/${appKey}`, {
      method: 'PATCH', body: JSON.stringify({ enabled }),
    });
    return { ok: true };
  } catch (e) { return toActionError(e); }
}
