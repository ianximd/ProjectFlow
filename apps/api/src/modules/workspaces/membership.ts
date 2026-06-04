import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';

export async function isWorkspaceMember(workspaceId: string, userId: string): Promise<boolean> {
  const rows = await execSpOne<{ Cnt: number }>('usp_WorkspaceMember_Exists', [
    { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
    { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
  ]);
  return (rows[0]?.Cnt ?? 0) > 0;
}
