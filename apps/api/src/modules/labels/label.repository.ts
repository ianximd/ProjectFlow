import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { Label } from '@projectflow/types';

export class LabelRepository {
  async list(projectId: string): Promise<Label[]> {
    const rs = await execSpOne<any>('usp_Label_List', { ProjectId: projectId });
    return rs.map(mapRow);
  }

  async getWorkspaceId(id: string): Promise<string | null> {
    const rs = await execSpOne<{ WorkspaceId: string }>('usp_Label_GetWorkspaceId', { LabelId: id });
    return rs[0]?.WorkspaceId ?? null;
  }

  async create(projectId: string, name: string, color: string): Promise<Label> {
    const rs = await execSpOne<any>('usp_Label_Create', {
      ProjectId: projectId,
      Name: name,
      Color: color,
    });
    return mapRow(rs[0]);
  }

  async update(id: string, patch: { name?: string; color?: string }): Promise<Label | null> {
    const rs = await execSpOne<any>('usp_Label_Update', {
      Id:    id,
      Name:  patch.name  ?? null,
      Color: patch.color ?? null,
    });
    if (!rs || !rs[0]) return null;
    return mapRow(rs[0]);
  }

  async delete(id: string): Promise<void> {
    await execSpOne<any>('usp_Label_Delete', { Id: id });
  }
}

function mapRow(row: any): Label {
  return {
    id:         row.Id,
    projectId:  row.ProjectId,
    name:       row.Name,
    color:      row.Color,
    createdAt:  String(row.CreatedAt),
    issueCount: Number(row.IssueCount ?? 0),
  };
}
