import type { AggregateOp, CardConfig, DashboardVisibility, ViewConfig } from '@projectflow/types';

/** Lift a per-card config into the ViewConfig the Phase 3 compiler accepts.
 *  Generic cards ARE saved queries — this is the only translation needed. */
export function cardConfigToViewConfig(card: CardConfig): ViewConfig {
  return {
    filter: card.filter ?? { conjunction: 'AND', rules: [] },
    groupBy: card.groupBy,
    sort: card.sort ?? [{ field: { kind: 'builtin', key: 'position' }, dir: 'ASC' }],
    columns: card.columns,
    pageSize: card.pageSize,
  };
}

/** Fold a numeric field over rows. `count` ignores the accessor.
 *  sum→0 / avg|min|max→null on empty; non-numeric values are skipped. */
export function computeAggregate<T>(
  op: AggregateOp,
  rows: readonly T[],
  field: (row: T) => unknown,
): number | null {
  if (op === 'count') return rows.length;
  const nums = rows
    .map((r) => field(r))
    .map((v) => (typeof v === 'number' ? v : Number(v)))
    .filter((v): v is number => Number.isFinite(v));
  if (op === 'sum') return nums.reduce((a, b) => a + b, 0);
  if (nums.length === 0) return null;
  if (op === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length;
  if (op === 'min') return Math.min(...nums);
  return Math.max(...nums); // 'max'
}

/** Owner always reads; others read shared/protected, never private. */
export function canReadDashboard(d: { ownerId: string; visibility: DashboardVisibility }, userId: string): boolean {
  if (d.ownerId === userId) return true;
  return d.visibility !== 'private';
}

/** Pure preview of the one-default-per-scope mutation (mirrors usp_Dashboard_SetDefault):
 *  clear IsDefault on same-scope siblings, set it on the target. */
export function nextDefaultMutation<
  T extends { id: string; scopeType: string; scopeId: string | null; isDefault: boolean },
>(rows: T[], targetId: string): T[] {
  const target = rows.find((r) => r.id === targetId);
  if (!target) return rows;
  return rows.map((r) => {
    if (r.id === targetId) return { ...r, isDefault: true };
    const sameScope = r.scopeType === target.scopeType && r.scopeId === target.scopeId;
    return sameScope ? { ...r, isDefault: false } : r;
  });
}
