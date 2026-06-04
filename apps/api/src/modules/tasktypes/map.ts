import type { TaskType } from '@projectflow/types';

export function mapTaskTypeRow(r: any): TaskType {
  return {
    id: r.Id,
    workspaceId: r.WorkspaceId,
    nameSingular: r.NameSingular,
    namePlural: r.NamePlural,
    icon: r.Icon ?? null,
    isMilestone: !!r.IsMilestone,
    isDefault: !!r.IsDefault,
    position: Number(r.Position),
    createdAt: String(r.CreatedAt),
    updatedAt: String(r.UpdatedAt),
  };
}
