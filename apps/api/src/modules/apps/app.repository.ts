import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { AppKey, AppScopeType, AppToggle } from '@projectflow/types';
import type { OverrideRow } from './app-registry.js';

interface ChainRowDb {
  AppKey:    string;
  Enabled:   boolean;
  ScopeType: string;
  ScopeId:   string | null;
  Depth:     number;
}
interface ToggleRowDb {
  AppKey:    string;
  Enabled:   boolean;
  ScopeType: string;
  ScopeId:   string | null;
}

export class AppRepository {
  /** The ancestry override chain for a scope node (most-specific resolution input). */
  async listChainForScope(
    workspaceId: string,
    scopeType: AppScopeType,
    scopeId: string | null,
  ): Promise<OverrideRow[]> {
    // execSpOne returns the first recordset (an IRecordSet<T> = array of rows).
    const rows = await execSpOne<ChainRowDb>('usp_AppsEnabled_ListForScope', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'ScopeType',   type: sql.NVarChar(12),     value: scopeType },
      { name: 'ScopeId',     type: sql.UniqueIdentifier, value: scopeId },
    ]);
    return Array.from(rows).map((r) => ({
      appKey:    r.AppKey as AppKey,
      enabled:   Boolean(r.Enabled),
      scopeType: r.ScopeType as AppScopeType,
      scopeId:   r.ScopeId,
      depth:     r.Depth,
    }));
  }

  /** Overrides for EXACTLY this scope (the App Center's own-rows view). */
  async listForScope(
    workspaceId: string,
    scopeType: AppScopeType,
    scopeId: string | null,
  ): Promise<AppToggle[]> {
    const chain = await this.listChainForScope(workspaceId, scopeType, scopeId);
    return chain
      .filter((r) => r.scopeType === scopeType && r.scopeId === scopeId)
      .map((r) => ({ appKey: r.appKey, scopeType: r.scopeType, scopeId: r.scopeId, enabled: r.enabled }));
  }

  /** Upsert (enabled=true|false) or clear (enabled=null) one override. */
  async setOverride(
    workspaceId: string,
    scopeType: AppScopeType,
    scopeId: string | null,
    appKey: AppKey,
    enabled: boolean | null,
    updatedBy: string | null,
  ): Promise<AppToggle | null> {
    // execSpOne returns the first recordset; the SP returns the row(s) after the
    // write, so take the first row. A clear (enabled=null) may return no rows.
    const rows = await execSpOne<ToggleRowDb>('usp_AppsEnabled_Set', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'ScopeType',   type: sql.NVarChar(12),     value: scopeType },
      { name: 'ScopeId',     type: sql.UniqueIdentifier, value: scopeId },
      { name: 'AppKey',      type: sql.NVarChar(40),     value: appKey },
      { name: 'Enabled',     type: sql.Bit,              value: enabled },
      { name: 'UpdatedBy',   type: sql.UniqueIdentifier, value: updatedBy },
    ]);
    const r = rows[0];
    return r
      ? { appKey: r.AppKey as AppKey, scopeType: r.ScopeType as AppScopeType, scopeId: r.ScopeId, enabled: Boolean(r.Enabled) }
      : null;
  }
}
