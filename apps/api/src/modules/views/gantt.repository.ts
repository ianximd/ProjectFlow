import sql from 'mssql';
import { execSp, execSpOne } from '../../shared/lib/sqlClient.js';
import type { GanttEdge, GanttBaseline, BaselineTask } from '@projectflow/types';

export class GanttRepository {
  /** Edges among a supplied set of task ids (usp_View_GanttDeps). */
  async listScopeDependencies(taskIds: string[]): Promise<GanttEdge[]> {
    if (taskIds.length === 0) return [];
    const rows = await execSpOne<{ TaskId: string; DependsOn: string }>('usp_View_GanttDeps', [
      { name: 'TaskIds', type: sql.NVarChar(sql.MAX), value: taskIds.join(',') },
    ]);
    return rows.map((r) => ({ taskId: r.TaskId, dependsOn: r.DependsOn }));
  }

  /** Insert a baseline header + freeze the in-scope tasks' dates (usp_Baseline_Capture).
   *  Returns the new header with an empty `tasks` (the next list() re-reads frozen rows). */
  async captureBaseline(viewId: string, name: string, createdBy: string, taskIds: string[]): Promise<GanttBaseline> {
    const rows = await execSpOne<any>('usp_Baseline_Capture', [
      { name: 'ViewId',    type: sql.UniqueIdentifier, value: viewId },
      { name: 'Name',      type: sql.NVarChar(200),    value: name },
      { name: 'CreatedBy', type: sql.UniqueIdentifier, value: createdBy },
      { name: 'TaskIds',   type: sql.NVarChar(sql.MAX), value: taskIds.length ? taskIds.join(',') : null },
    ]);
    const h = rows[0];
    return {
      id: h.Id, viewId: h.ViewId, name: h.Name,
      capturedAt: new Date(h.CapturedAt).toISOString(), createdBy: h.CreatedBy, tasks: [],
    };
  }

  /** A view's baselines + their frozen task rows (usp_Baseline_List → 2 recordsets). */
  async listBaselines(viewId: string): Promise<GanttBaseline[]> {
    const sets = await execSp<any>('usp_Baseline_List', [
      { name: 'ViewId', type: sql.UniqueIdentifier, value: viewId },
    ]);
    const headers = (sets[0] ?? []) as any[];
    const frozen  = (sets[1] ?? []) as any[];
    const byBaseline = new Map<string, BaselineTask[]>();
    for (const f of frozen) {
      const k = String(f.BaselineId);
      const list = byBaseline.get(k) ?? [];
      list.push({
        taskId:    f.TaskId,
        startDate: f.StartDate ? new Date(f.StartDate).toISOString() : null,
        dueDate:   f.DueDate ? new Date(f.DueDate).toISOString() : null,
      });
      byBaseline.set(k, list);
    }
    return headers.map((h) => ({
      id: h.Id, viewId: h.ViewId, name: h.Name,
      capturedAt: new Date(h.CapturedAt).toISOString(), createdBy: h.CreatedBy,
      tasks: byBaseline.get(String(h.Id)) ?? [],
    }));
  }
}
