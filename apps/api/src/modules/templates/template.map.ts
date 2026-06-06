import type { Template } from '@projectflow/types';

/**
 * Map a Templates row (PascalCase from the SP) to the API Template type.
 * Snapshot is intentionally NOT exposed here — it is large and only the
 * apply path reads it (via the service's getSnapshot). The list/getById REST
 * + GraphQL surfaces return metadata only.
 */
export function mapTemplateRow(r: any): Template {
  return {
    id: r.Id,
    workspaceId: r.WorkspaceId,
    scopeType: r.ScopeType,
    name: r.Name,
    description: r.Description ?? null,
    createdById: r.CreatedById,
    createdAt: String(r.CreatedAt),
    updatedAt: r.UpdatedAt != null ? String(r.UpdatedAt) : undefined,
    deletedAt: r.DeletedAt != null ? String(r.DeletedAt) : null,
  };
}
