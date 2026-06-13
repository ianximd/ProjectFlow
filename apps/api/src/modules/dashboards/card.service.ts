import { dashboardService } from './dashboard.service.js';
import { DashboardRepository } from './dashboard.repository.js';
import { cardConfigToViewConfig, computeAggregate } from './card.aggregate.js';
import { viewService } from '../views/view.service.js';
import { goalService } from '../goals/goal.service.js';
import type { CardData, CardType, Dashboard, DashboardCard, FieldRef } from '@projectflow/types';

const repo = new DashboardRepository();

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
