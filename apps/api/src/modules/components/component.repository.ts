import { execSp, execSpOne } from '../../shared/lib/sqlClient.js';
import type { ProjectComponent } from '@projectflow/types';

export class ComponentRepository {
  async list(projectId: string): Promise<ProjectComponent[]> {
    const rs = await execSpOne<any>('usp_Component_List', { ProjectId: projectId });
    return rs.map(mapRow);
  }

  async getWorkspaceId(id: string): Promise<string | null> {
    const rs = await execSpOne<{ WorkspaceId: string }>('usp_Component_GetWorkspaceId', { ComponentId: id });
    return rs[0]?.WorkspaceId ?? null;
  }

  async create(
    projectId:   string,
    name:        string,
    description: string | null,
    leadUserId:  string | null,
  ): Promise<ProjectComponent> {
    const rs = await execSpOne<any>('usp_Component_Create', {
      ProjectId:  projectId,
      Name:       name,
      Description: description ?? null,
      LeadUserId: leadUserId ?? null,
    });
    return mapRow(rs[0]);
  }

  async update(id: string, patch: {
    name?: string;
    description?: string | null;
    leadUserId?: string | null;
  }): Promise<ProjectComponent | null> {
    const rs = await execSpOne<any>('usp_Component_Update', {
      Id:          id,
      Name:        patch.name ?? null,
      Description: patch.description ?? null,
      LeadUserId:  patch.leadUserId ?? null,
    });
    if (!rs || !rs[0]) return null;
    return mapRow(rs[0]);
  }

  async delete(id: string): Promise<void> {
    await execSpOne<any>('usp_Component_Delete', { Id: id });
  }
}

function mapRow(row: any): ProjectComponent {
  return {
    id:            row.Id,
    projectId:     row.ProjectId,
    name:          row.Name,
    description:   row.Description ?? null,
    leadUserId:    row.LeadUserId ?? null,
    leadUserName:  row.LeadUserName ?? null,
    leadAvatarUrl: row.LeadAvatarUrl ?? null,
    createdAt:     String(row.CreatedAt),
    issueCount:    Number(row.IssueCount ?? 0),
  };
}
