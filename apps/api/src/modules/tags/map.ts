import type { Tag } from '@projectflow/types';

// A Tag IS a Label (dbo.Labels). issueCount isn't computed on this surface (0).
export function mapTagRow(r: any): Tag {
  return {
    id: r.Id,
    projectId: r.ProjectId,
    name: r.Name,
    color: r.Color,
    createdAt: String(r.CreatedAt),
    issueCount: 0,
  };
}
