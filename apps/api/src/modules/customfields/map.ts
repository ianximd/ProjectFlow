import type { CustomField, CustomFieldConfig, EffectiveField } from '@projectflow/types';

function parseConfig(raw: unknown): CustomFieldConfig | null {
  if (raw == null || raw === '') return null;
  try { return JSON.parse(String(raw)) as CustomFieldConfig; } catch { return null; }
}

export function mapCustomFieldRow(r: any): CustomField {
  return {
    id: r.Id, workspaceId: r.WorkspaceId, scopeType: r.ScopeType, scopeId: r.ScopeId,
    scopePath: r.ScopePath, type: r.Type, name: r.Name, config: parseConfig(r.Config),
    required: !!r.Required, position: Number(r.Position),
    createdAt: String(r.CreatedAt), updatedAt: String(r.UpdatedAt),
  };
}

/** Rows from usp_CustomField_EffectiveForTask carry an extra CurrentValue column. */
export function mapEffectiveFieldRow(r: any): EffectiveField {
  const field = mapCustomFieldRow(r);
  let value: unknown = null;
  if (r.CurrentValue != null && r.CurrentValue !== '') {
    try { value = JSON.parse(String(r.CurrentValue)); } catch { value = null; }
  }
  return { field, value };
}
