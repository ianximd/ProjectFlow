import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { EpicSummary } from '@projectflow/types';

export class EpicRepository {
  async list(projectId: string): Promise<EpicSummary[]> {
    const rs = await execSpOne<any>('usp_Epic_List', { ProjectId: projectId });
    return rs.map((row: any): EpicSummary => ({
      id:                row.Id,
      issueKey:          row.IssueKey,
      title:             row.Title,
      status:            row.Status,
      priority:          row.Priority,
      dueDate:           row.DueDate ? String(row.DueDate).split('T')[0] : null,
      createdAt:         String(row.CreatedAt),
      totalChildren:     Number(row.TotalChildren ?? 0),
      completedChildren: Number(row.CompletedChildren ?? 0),
    }));
  }
}
