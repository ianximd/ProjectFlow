import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { EpicSummary } from '@projectflow/types';

// The MSSQL driver returns DATE / DATETIME2 columns as JS Date objects.
// String(date) yields the human-readable toString form
// ("Tue May 19 2026 07:00:00 GMT+0700 ..."), so splitting on 'T' silently
// breaks: values starting with "Tue"/"Thu" pop the leading 'T' and return
// "", while others get truncated mid-"GMT". Go through toISOString so the
// output is a proper YYYY-MM-DD for date columns.
function toIsoDate(d: unknown): string | null {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().split('T')[0]!;
  // Fallback: if the driver ever hands back a string, only split when it
  // actually has the ISO 'T' separator — never on plain weekday strings.
  const s = String(d);
  return s.includes('T') ? s.split('T')[0]! : s;
}

export class EpicRepository {
  async list(projectId: string): Promise<EpicSummary[]> {
    const rs = await execSpOne<any>('usp_Epic_List', { ProjectId: projectId });
    return rs.map((row: any): EpicSummary => ({
      id:                row.Id,
      issueKey:          row.IssueKey,
      title:             row.Title,
      status:            row.Status,
      priority:          row.Priority,
      startDate:         toIsoDate(row.StartDate),
      dueDate:           toIsoDate(row.DueDate),
      createdAt:         row.CreatedAt instanceof Date
                           ? row.CreatedAt.toISOString()
                           : String(row.CreatedAt),
      totalChildren:     Number(row.TotalChildren ?? 0),
      completedChildren: Number(row.CompletedChildren ?? 0),
    }));
  }
}
