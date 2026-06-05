import type { SavedView, ViewConfig } from '@projectflow/types';

export function mapSavedViewRow(row: any): SavedView {
  return {
    id: row.Id,
    workspaceId: row.WorkspaceId,
    ownerId: row.OwnerId,
    scopeType: row.ScopeType,
    scopeId: row.ScopeId ?? null,
    type: row.Type,
    name: row.Name,
    isShared: !!row.IsShared,
    isDefault: !!row.IsDefault,
    config: JSON.parse(row.Config) as ViewConfig,
    position: row.Position,
  };
}
