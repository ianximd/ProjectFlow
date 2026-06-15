import { GanttRepository } from './gantt.repository.js';
import { ViewService } from './view.service.js';
import type {
  GanttTask, GanttBaseline, BaselineTask, ViewGanttData,
  ViewScopeType, ViewConfig,
} from '@projectflow/types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Minimal shapes the pure helpers need (the full GanttTask is a superset).
export interface GanttTaskLike { id: string; startDate: string | null; dueDate: string | null }
export interface GanttEdgeLike { taskId: string; dependsOn: string }

/** Whole-day duration of a task's [start, due] window; 0 when either end is
 *  missing or due precedes start. */
export function durationDays(t: GanttTaskLike): number {
  if (!t.startDate || !t.dueDate) return 0;
  const a = Date.parse(t.startDate);
  const b = Date.parse(t.dueDate);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / MS_PER_DAY));
}

/**
 * The critical path: the task-id chain with the greatest summed duration through
 * the dependency DAG. `edge.dependsOn` must finish before `edge.taskId`, so we
 * relax over edges from predecessor → successor. The graph is acyclic
 * (usp_TaskDependency_Add rejects cycles), so a memoized longest-path DFS is safe.
 */
export function criticalPath(tasks: GanttTaskLike[], edges: GanttEdgeLike[]): string[] {
  if (tasks.length === 0) return [];
  const dur = new Map<string, number>(tasks.map((t) => [t.id, durationDays(t)]));
  // predecessors[id] = tasks that must finish before id (id waits on them).
  const preds = new Map<string, string[]>();
  for (const t of tasks) preds.set(t.id, []);
  for (const e of edges) {
    if (preds.has(e.taskId) && dur.has(e.dependsOn)) preds.get(e.taskId)!.push(e.dependsOn);
  }

  const best = new Map<string, { len: number; path: string[] }>();
  const visiting = new Set<string>();
  const longestTo = (id: string): { len: number; path: string[] } => {
    const cached = best.get(id);
    if (cached) return cached;
    if (visiting.has(id)) return { len: 0, path: [id] }; // defensive: ignore any residual cycle
    visiting.add(id);
    const self = dur.get(id) ?? 0;
    let chosen: { len: number; path: string[] } = { len: self, path: [id] };
    for (const p of preds.get(id) ?? []) {
      const up = longestTo(p);
      const cand = up.len + self;
      // Prefer greater duration; on a tie, prefer the longer chain (more nodes)
      // so a zero-duration successor still extends the critical path.
      if (cand > chosen.len || (cand === chosen.len && up.path.length + 1 > chosen.path.length)) {
        chosen = { len: cand, path: [...up.path, id] };
      }
    }
    visiting.delete(id);
    best.set(id, chosen);
    return chosen;
  };

  let winner: { len: number; path: string[] } = { len: -1, path: [] };
  for (const t of tasks) {
    const r = longestTo(t.id);
    // Same tie-break as above: equal duration → keep the chain with more nodes.
    if (r.len > winner.len || (r.len === winner.len && r.path.length > winner.path.length)) winner = r;
  }
  return winner.path;
}

/** Per-task whole-day drift of `current` dates vs a captured baseline. Tasks not
 *  present in the baseline are omitted. */
export interface BaselineDiffEntry {
  taskId:         string;
  startDeltaDays: number;
  dueDeltaDays:   number;
  changed:        boolean;
}
export function baselineDiff(current: GanttTaskLike[], captured: BaselineTask[]): BaselineDiffEntry[] {
  const base = new Map(captured.map((b) => [b.taskId, b]));
  const deltaDays = (a: string | null, b: string | null): number => {
    if (!a || !b) return 0;
    const x = Date.parse(a); const y = Date.parse(b);
    if (Number.isNaN(x) || Number.isNaN(y)) return 0;
    return Math.round((y - x) / MS_PER_DAY);
  };
  const out: BaselineDiffEntry[] = [];
  for (const t of current) {
    const b = base.get(t.id);
    if (!b) continue;
    const startDeltaDays = deltaDays(b.startDate, t.startDate);
    const dueDeltaDays   = deltaDays(b.dueDate,   t.dueDate);
    out.push({ taskId: t.id, startDeltaDays, dueDeltaDays, changed: startDeltaDays !== 0 || dueDeltaDays !== 0 });
  }
  return out;
}

// ── Assembly (impure) ─────────────────────────────────────────────────────────

export class GanttService {
  private repo = new GanttRepository();
  private views = new ViewService();

  /** Build the Gantt payload for a saved view: in-scope tasks (Phase 3 compiler) +
   *  dependency edges among them + the critical path + the view's baselines.
   *
   *  NOTE: ViewService.runConfig returns RAW PascalCase `SELECT t.*` rows (the
   *  camelCase normalization lives only in the GraphQL mapTaskRow layer), so the
   *  reads below are PascalCase by design — r.Id / r.StartDate / r.Assignees[].UserId. */
  async resolve(
    userId: string,
    scopeType: ViewScopeType,
    scopeId: string | null,
    config: ViewConfig,
    workspaceId: string | undefined,
    viewId: string,
  ): Promise<ViewGanttData> {
    // Reuse the exact compiled task query the other views use. A generous page
    // bound keeps the whole scope on one Gantt canvas (bounded by MAX_PAGE_SIZE).
    const page = await this.views.runConfig(scopeType, scopeId, config, { page: 1, pageSize: 200 }, workspaceId, userId);
    const tasks: GanttTask[] = (page.tasks as any[]).map((r) => ({
      id:          r.Id,
      title:       r.Title,
      status:      r.Status,
      startDate:   r.StartDate ? new Date(r.StartDate).toISOString() : null,
      dueDate:     r.DueDate ? new Date(r.DueDate).toISOString() : null,
      assigneeIds: (r.Assignees ?? []).map((a: any) => a.UserId),
    }));
    const ids = tasks.map((t) => t.id);
    const edges = await this.repo.listScopeDependencies(ids);
    const baselines = await this.repo.listBaselines(viewId);
    return { tasks, edges, criticalPathIds: criticalPath(tasks, edges), baselines };
  }

  async capture(viewId: string, name: string, createdBy: string, taskIds: string[]): Promise<GanttBaseline> {
    return this.repo.captureBaseline(viewId, name, createdBy, taskIds);
  }
}

export const ganttService = new GanttService();
