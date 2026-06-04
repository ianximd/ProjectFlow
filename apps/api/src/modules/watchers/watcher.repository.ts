import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { TaskWatcher } from '@projectflow/types';

function mapRow(r: any): TaskWatcher {
  return { taskId: r.TaskId, userId: r.UserId, createdAt: String(r.CreatedAt) };
}

export class WatcherRepository {
  async list(taskId: string): Promise<TaskWatcher[]> {
    const rows = await execSpOne('usp_TaskWatcher_List', [{ name: 'TaskId', type: sql.UniqueIdentifier, value: taskId }]);
    return (rows as any[]).map(mapRow);
  }

  async add(taskId: string, userId: string): Promise<TaskWatcher | null> {
    const rows = await execSpOne('usp_TaskWatcher_Add', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
      { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
    ]);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async remove(taskId: string, userId: string): Promise<void> {
    await execSpOne('usp_TaskWatcher_Remove', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
      { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
    ]);
  }
}
