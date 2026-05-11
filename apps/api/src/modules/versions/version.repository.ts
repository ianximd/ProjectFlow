import { execSp, execSpOne } from '../../shared/lib/sqlClient.js';
import type { Version } from '@projectflow/types';

export class VersionRepository {
  async list(projectId: string): Promise<Version[]> {
    const rs = await execSpOne<any>('usp_Version_List', { ProjectId: projectId });
    return rs.map(mapRow);
  }

  async getWorkspaceId(id: string): Promise<string | null> {
    const rs = await execSpOne<{ WorkspaceId: string }>('usp_Version_GetWorkspaceId', { VersionId: id });
    return rs[0]?.WorkspaceId ?? null;
  }

  async create(
    projectId: string,
    name: string,
    description: string | null,
    startDate: string | null,
    releaseDate: string | null,
  ): Promise<Version> {
    const rs = await execSpOne<any>('usp_Version_Create', {
      ProjectId: projectId,
      Name: name,
      Description: description ?? null,
      StartDate: startDate ?? null,
      ReleaseDate: releaseDate ?? null,
    });
    return mapRow(rs[0]);
  }

  async update(id: string, patch: {
    name?: string;
    description?: string | null;
    status?: string;
    startDate?: string | null;
    releaseDate?: string | null;
  }): Promise<Version | null> {
    const rs = await execSpOne<any>('usp_Version_Update', {
      Id: id,
      Name: patch.name ?? null,
      Description: patch.description ?? null,
      Status: patch.status ?? null,
      StartDate: patch.startDate ?? null,
      ReleaseDate: patch.releaseDate ?? null,
    });
    if (!rs || !rs[0]) return null;
    return mapRow(rs[0]);
  }

  async delete(id: string): Promise<void> {
    await execSpOne<any>('usp_Version_Delete', { Id: id });
  }
}

function mapRow(row: any): Version {
  return {
    id: row.Id,
    projectId: row.ProjectId,
    name: row.Name,
    description: row.Description ?? null,
    status: row.Status,
    startDate: row.StartDate ? String(row.StartDate).split('T')[0] : null,
    releaseDate: row.ReleaseDate ? String(row.ReleaseDate).split('T')[0] : null,
    releasedAt: row.ReleasedAt ? String(row.ReleasedAt) : null,
    createdAt: String(row.CreatedAt),
    totalIssues: Number(row.TotalIssues ?? 0),
    completedIssues: Number(row.CompletedIssues ?? 0),
  };
}
