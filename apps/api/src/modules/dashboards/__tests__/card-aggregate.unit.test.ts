import { describe, it, expect } from 'vitest';
import { cardConfigToViewConfig, computeAggregate } from '../card.aggregate.js';
import type { CardConfig } from '@projectflow/types';

describe('cardConfigToViewConfig', () => {
  it('maps a card filter/groupBy/sort to a ViewConfig the Phase 3 compiler accepts', () => {
    const card: CardConfig = {
      filter: { conjunction: 'AND', rules: [{ field: { kind: 'builtin', key: 'status' }, op: '=', value: 'Done' }] },
      groupBy: { kind: 'builtin', key: 'priority' },
      sort: [{ field: { kind: 'builtin', key: 'position' }, dir: 'ASC' }],
      pageSize: 50,
    };
    const vc = cardConfigToViewConfig(card);
    expect(vc.filter.rules).toHaveLength(1);
    expect(vc.groupBy).toEqual({ kind: 'builtin', key: 'priority' });
    expect(vc.pageSize).toBe(50);
  });

  it('defaults an empty filter + position sort when the card omits them', () => {
    const vc = cardConfigToViewConfig({});
    expect(vc.filter).toEqual({ conjunction: 'AND', rules: [] });
    expect(vc.sort).toEqual([{ field: { kind: 'builtin', key: 'position' }, dir: 'ASC' }]);
  });
});

describe('computeAggregate', () => {
  const vals = [2, 4, 6, 8];
  it('count ignores the field and returns row length', () => {
    expect(computeAggregate('count', [10, 20, 30], () => 1)).toBe(3);
  });
  it('sum / avg / min / max over a numeric field', () => {
    expect(computeAggregate('sum', vals, (v) => v)).toBe(20);
    expect(computeAggregate('avg', vals, (v) => v)).toBe(5);
    expect(computeAggregate('min', vals, (v) => v)).toBe(2);
    expect(computeAggregate('max', vals, (v) => v)).toBe(8);
  });
  it('returns 0 for sum and null for avg/min/max over no rows', () => {
    expect(computeAggregate('sum', [], (v: number) => v)).toBe(0);
    expect(computeAggregate('avg', [], (v: number) => v)).toBeNull();
    expect(computeAggregate('min', [], (v: number) => v)).toBeNull();
    expect(computeAggregate('max', [], (v: number) => v)).toBeNull();
  });
  it('skips non-numeric / null field values in sum/avg', () => {
    expect(computeAggregate('sum', [3, null, 'x', 7], (v) => v as number)).toBe(10);
  });
});
