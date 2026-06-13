import { dashboardService } from './dashboard.service.js';
import { DashboardRepository } from './dashboard.repository.js';
import { cardConfigToViewConfig, computeAggregate } from './card.aggregate.js';
import { viewService } from '../views/view.service.js';
import { goalService } from '../goals/goal.service.js';
import { ReportsService } from '../reports/reports.service.js';
import { WorkLogService } from '../worklogs/worklog.service.js';
import { sprintService } from '../sprints/sprint.service.js';
import { projectService } from '../projects/project.service.js';
import { CustomFieldRepository } from '../customfields/customfield.repository.js';
import { TaskRepository } from '../tasks/task.repository.js';
import type { CardData, CardType, Dashboard, DashboardCard, FieldRef } from '@projectflow/types';

const repo = new DashboardRepository();
const reportsSvc = new ReportsService();
const worklogSvc = new WorkLogService();
const cfRepo = new CustomFieldRepository();
const taskRepo = new TaskRepository();

/** A resolver turns a card + its dashboard scope into a CardData payload. The
 *  registry is the extension seam: 9b registers more types here; 9c snapshots a
 *  dashboard by iterating every card through this same resolve(). */
export type CardResolver = (card: DashboardCard, dashboard: Dashboard, userId: string) => Promise<CardData>;

// Map a card's dashboard scope onto the view scope the Phase 3 compiler accepts.
function viewScope(d: Dashboard): { scopeType: 'EVERYTHING' | 'SPACE' | 'FOLDER' | 'LIST'; scopeId: string | null } {
  if (d.scopeType === 'workspace') return { scopeType: 'EVERYTHING', scopeId: null };
  return { scopeType: d.scopeType.toUpperCase() as 'SPACE' | 'FOLDER' | 'LIST', scopeId: d.scopeId };
}

/** Run a generic card's config through the Phase 3 compiler under the dashboard
 *  scope. The route/GraphQL layer has already asserted requireObjectLevel(VIEW)
 *  on the scope, so a user without access never reaches here for that scope. */
async function runGeneric(card: DashboardCard, d: Dashboard, userId: string, pageSize: number) {
  const vs = viewScope(d);
  return viewService.runConfig(
    vs.scopeType, vs.scopeId, cardConfigToViewConfig({ ...card.config, pageSize }),
    { page: 1, pageSize }, d.workspaceId, userId,
  );
}

// Read a (possibly custom) numeric field off a compiled task row for aggregation.
function fieldAccessor(field?: FieldRef): (row: any) => unknown {
  if (!field) return () => 1;
  if (field.kind === 'builtin') {
    const col = field.key === 'story_points' ? 'StoryPoints' : field.key;
    return (row) => row[col] ?? row[field.key];
  }
  return (row) => row.CustomFieldValues?.[field.key.toLowerCase()];
}

async function resolveTaskList(card: DashboardCard, d: Dashboard, userId: string): Promise<CardData> {
  const page = await runGeneric(card, d, userId, card.config.pageSize ?? 25);
  return { cardId: card.id, type: 'task_list', shape: 'rows', data: page.tasks, total: page.total };
}

async function resolveCalculation(card: DashboardCard, d: Dashboard, userId: string): Promise<CardData> {
  const op = card.config.aggregate?.op ?? 'count';
  // `count` is exact (DB-side page.total). KNOWN LIMITATION: sum/avg/min/max fold a
  // single bounded page (viewService clamps pageSize to MAX_PAGE_SIZE=200), so an
  // aggregate over a scope with >200 matching tasks is computed over the first 200
  // only. 9a's UI exposes no field picker, so field-aggregates aren't yet reachable;
  // 9b (which adds field selection) must move sum/avg/min/max into SQL before relying
  // on them. See DECISIONS.md §'2026-06-13 — Phase 9a'.
  const page = await runGeneric(card, d, userId, op === 'count' ? 1 : 200);
  const value = op === 'count' ? page.total : computeAggregate(op, page.tasks as any[], fieldAccessor(card.config.aggregate?.field));
  return { cardId: card.id, type: 'calculation', shape: 'scalar', data: { value } };
}

// bar/line/pie share the same grouped-count series shape (Phase 3 groupCounts).
function makeSeriesResolver(type: CardType): CardResolver {
  return async (card, d, userId) => {
    const page = await runGeneric(card, d, userId, card.config.pageSize ?? 200);
    const series = (page.groups ?? []).map((g) => ({ key: g.key, label: g.label, value: g.count }));
    return { cardId: card.id, type, shape: 'series', data: series };
  };
}

async function resolveTimeTracked(card: DashboardCard, d: Dashboard): Promise<CardData> {
  const scope = await dashboardService.resolveScope(d.scopeType, d.scopeId, d.workspaceId);
  const prefix = scope.scopePath ? `${scope.scopePath}%` : null;
  const totals = await repo.timeTracked(d.workspaceId, prefix);
  return { cardId: card.id, type: 'time_tracked', shape: 'totals', data: totals };
}

// Phase 8 goal.service IS built — resolve the real goal progress, but never
// surface a goal from another workspace via a card (cross-tenant guard).
async function resolveGoal(card: DashboardCard, d: Dashboard): Promise<CardData> {
  const goalId = card.config.goalId;
  if (!goalId) return { cardId: card.id, type: 'goal', shape: 'scalar', data: { value: null, pending: true } };
  const goal = await goalService.getGoalWithProgress(goalId);
  if (!goal || goal.workspaceId !== d.workspaceId) {
    return { cardId: card.id, type: 'goal', shape: 'scalar', data: { value: null, pending: true } };
  }
  return { cardId: card.id, type: 'goal', shape: 'scalar', data: { value: goal.progress, goalId, name: goal.name } };
}

// 9b report/entity card params live in card.config.reportParams.
interface ReportParams {
  sprintId?: string; projectId?: string; numSprints?: number;
  scopeType?: string; scopeId?: string; scopeIds?: string[]; weeks?: number;
  taskId?: string; target?: number;
}
function rp(card: DashboardCard): ReportParams { return (card.config.reportParams ?? {}) as ReportParams; }

// A report card's params are attacker-controllable by anyone who can EDIT the
// dashboard, so a card could point at a sprint/scope/task in ANOTHER workspace.
// Mirror resolveGoal: resolve the param's OWNING workspace and refuse to surface
// data unless it matches the dashboard's workspace. Fail closed on null/error.
function pendingReport(card: DashboardCard): CardData {
  return { cardId: card.id, type: card.type, shape: 'report', data: null };
}
async function wsForSprint(id?: string): Promise<string | null> {
  if (!id) return null;
  try { return await sprintService.getSprintWorkspaceId(id); } catch { return null; }
}
async function wsForProject(id?: string): Promise<string | null> {
  if (!id) return null;
  try { const p = await projectService.getById(id); return (p as any)?.WorkspaceId ?? null; } catch { return null; }
}
async function wsForScope(scopeType?: string, scopeId?: string): Promise<string | null> {
  if (!scopeType || !scopeId) return null;
  try { const n = await cfRepo.getScopeNode(scopeType.toUpperCase() as any, scopeId); return n?.workspaceId ?? null; } catch { return null; }
}
async function wsForTask(taskId?: string): Promise<string | null> {
  if (!taskId) return null;
  // Dedicated SP seam: TaskRepository.getWorkspaceId → Promise<string|null>.
  try { return await taskRepo.getWorkspaceId(taskId); } catch { return null; }
}

async function resolveBurndown(card: DashboardCard, d: Dashboard): Promise<CardData> {
  const { sprintId } = rp(card);
  if (!sprintId || (await wsForSprint(sprintId)) !== d.workspaceId) return pendingReport(card);
  return { cardId: card.id, type: card.type, shape: 'report', data: await reportsSvc.burndown(sprintId) };
}
async function resolveVelocity(card: DashboardCard, d: Dashboard): Promise<CardData> {
  const { projectId, numSprints } = rp(card);
  if (!projectId || (await wsForProject(projectId)) !== d.workspaceId) return pendingReport(card);
  return { cardId: card.id, type: card.type, shape: 'report', data: await reportsSvc.velocity(projectId, numSprints ?? 5) };
}
async function resolveBurnup(card: DashboardCard, d: Dashboard): Promise<CardData> {
  const { sprintId } = rp(card);
  if (!sprintId || (await wsForSprint(sprintId)) !== d.workspaceId) return pendingReport(card);
  return { cardId: card.id, type: card.type, shape: 'report', data: await reportsSvc.burnup(sprintId) };
}
async function resolveCumulativeFlow(card: DashboardCard, d: Dashboard): Promise<CardData> {
  const { scopeType, scopeId, weeks } = rp(card);
  if (!scopeType || !scopeId || (await wsForScope(scopeType, scopeId)) !== d.workspaceId) return pendingReport(card);
  return { cardId: card.id, type: card.type, shape: 'report', data: await reportsSvc.cumulativeFlow(scopeType, scopeId, weeks ?? 8) };
}
async function resolveLeadCycleTime(card: DashboardCard, d: Dashboard): Promise<CardData> {
  const { scopeType, scopeId, weeks } = rp(card);
  if (!scopeType || !scopeId || (await wsForScope(scopeType, scopeId)) !== d.workspaceId) return pendingReport(card);
  return { cardId: card.id, type: card.type, shape: 'report', data: await reportsSvc.leadCycleTime(scopeType, scopeId, weeks ?? 12) };
}
async function resolveSprintSummary(card: DashboardCard, d: Dashboard): Promise<CardData> {
  const { sprintId } = rp(card);
  if (!sprintId || (await wsForSprint(sprintId)) !== d.workspaceId) return pendingReport(card);
  return { cardId: card.id, type: card.type, shape: 'report', data: await reportsSvc.sprintSummary(sprintId) };
}
async function resolvePortfolio(card: DashboardCard, d: Dashboard): Promise<CardData> {
  const { scopeType, scopeIds } = rp(card);
  const ids = scopeIds ?? [];
  if (!scopeType || ids.length === 0) return pendingReport(card);
  for (const id of ids) { if ((await wsForScope(scopeType, id)) !== d.workspaceId) return pendingReport(card); }
  return { cardId: card.id, type: card.type, shape: 'report', data: await reportsSvc.portfolio(scopeType, ids) };
}
async function resolveTimesheet(card: DashboardCard, d: Dashboard): Promise<CardData> {
  const { taskId } = rp(card);
  if (!taskId || (await wsForTask(taskId)) !== d.workspaceId) return pendingReport(card);
  return { cardId: card.id, type: card.type, shape: 'report', data: await worklogSvc.getRollup(taskId) };
}
// battery uses the 9a generic compiler path under the dashboard's OWN scope
// (no external id → inherently tenant-safe); aggregate value vs target.
async function resolveBattery(card: DashboardCard, d: Dashboard, userId: string): Promise<CardData> {
  const op = card.config.aggregate?.op ?? 'count';
  const page = await runGeneric(card, d, userId, op === 'count' ? 1 : 200);
  const value = op === 'count' ? page.total : (computeAggregate(op, page.tasks as any[], fieldAccessor(card.config.aggregate?.field)) ?? 0);
  const target = rp(card).target ?? 100;
  return { cardId: card.id, type: card.type, shape: 'scalar', data: { value: Math.round(value), target } };
}

export class CardService {
  private registry = new Map<CardType, CardResolver>();

  constructor() {
    this.registry.set('task_list', resolveTaskList);
    this.registry.set('calculation', resolveCalculation);
    this.registry.set('bar', makeSeriesResolver('bar'));
    this.registry.set('line', makeSeriesResolver('line'));
    this.registry.set('pie', makeSeriesResolver('pie'));
    this.registry.set('time_tracked', (c, d) => resolveTimeTracked(c, d));
    this.registry.set('goal', (c, d) => resolveGoal(c, d));
    this.registry.set('burndown',        (c, d) => resolveBurndown(c, d));
    this.registry.set('velocity',        (c, d) => resolveVelocity(c, d));
    this.registry.set('burnup',          (c, d) => resolveBurnup(c, d));
    this.registry.set('cumulative_flow', (c, d) => resolveCumulativeFlow(c, d));
    this.registry.set('lead_cycle_time', (c, d) => resolveLeadCycleTime(c, d));
    this.registry.set('sprint_summary',  (c, d) => resolveSprintSummary(c, d));
    this.registry.set('portfolio',       (c, d) => resolvePortfolio(c, d));
    this.registry.set('timesheet',       (c, d) => resolveTimesheet(c, d));
    this.registry.set('battery',         (c, d, userId) => resolveBattery(c, d, userId));
  }

  /** Extension seam for 9b/9c — register or override a type's resolver. */
  register(type: CardType, resolver: CardResolver): void {
    this.registry.set(type, resolver);
  }

  async resolve(card: DashboardCard, dashboard: Dashboard, userId: string): Promise<CardData> {
    const r = this.registry.get(card.type);
    if (!r) throw new Error(`No resolver for card type '${card.type}'`);
    return r(card, dashboard, userId);
  }
}

export const cardService = new CardService();
