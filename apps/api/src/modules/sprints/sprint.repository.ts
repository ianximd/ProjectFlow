import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';

export class SprintRepository {
  async create(projectId: string, name: string, goal: string | null, startDate: Date | null, endDate: Date | null) {
    const rows = await execSpOne('usp_Sprint_Create', [
      { name: 'ProjectId', type: sql.UniqueIdentifier,  value: projectId },
      { name: 'Name',      type: sql.NVarChar(255),     value: name },
      { name: 'Goal',      type: sql.NVarChar(sql.MAX), value: goal ?? null },
      { name: 'StartDate', type: sql.DateTime2,         value: startDate ?? null },
      { name: 'EndDate',   type: sql.DateTime2,         value: endDate ?? null },
    ]);
    return rows[0];
  }

  async list(projectId: string) {
    const rows = await execSpOne('usp_Sprint_List', [
      { name: 'ProjectId', type: sql.UniqueIdentifier, value: projectId },
    ]);
    return rows;
  }

  async start(id: string) {
    const rows = await execSpOne('usp_Sprint_Start', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0];
  }

  async complete(id: string) {
    const rows = await execSpOne('usp_Sprint_Complete', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0];
  }

  async getWorkspaceId(id: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_Sprint_GetWorkspaceId', [
      { name: 'SprintId', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0]?.WorkspaceId ?? null;
  }
}
