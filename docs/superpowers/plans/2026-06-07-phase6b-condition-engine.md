# Phase 6b — Condition Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the AND-only, stub-laden automation condition evaluator with a recursive **nested AND/OR group** engine. A new recursive `ConditionNode` model + a pure, fully unit-tested `evaluateConditionTree(node, ctx): boolean` evaluator supports every comparison `Operator` (`is | is_not | contains | gt | lt | before | after | is_set`). `ISSUE_MATCHES_FILTER` becomes a real check that **reuses the existing PQL parser** (`modules/search/pql.parser.ts`) and matches the parsed filter against the event's task in memory; `USER_HAS_ROLE` becomes a real **RBAC** check via the roles service (`roleService.listUserRoles`). A stored legacy flat `AutomationCondition[]` is read as an implicit top-level `AND` group, so **no data migration is needed**. The condition-builder UI is upgraded to nested AND/OR groups with a per-leaf operator dropdown.

**Architecture:** This slice is **pure-logic + UI**, with **no migration and no new SP** — it swaps the engine the 6a worker already calls. 6a wired `emitAutomationEvent` → BullMQ `automation` job → `automation.worker.ts`, which loads the rule fresh and calls `evaluateConditions(rule.conditions, payload)`. 6b: (1) extend `@projectflow/types` with the recursive `ConditionNode`/`Operator` model alongside the kept legacy `AutomationCondition`; (2) add `parseConditionTree(stored)` — a backward-compatible adapter turning either a legacy flat array OR a stored tree into one canonical `ConditionNode`; (3) add the pure `evaluateConditionTree(node, ctx)` evaluator in `automation.conditions.ts`, keeping `evaluateConditions` as a thin legacy shim; (4) build a `ConditionContext` from the event payload (task before/after, actor, comment) and inject two async resolvers (`matchesFilter`, `userHasRole`) so the core tree-walk stays pure/sync-testable while leaf evaluation that needs IO is awaited at the worker boundary; (5) point the worker at `evaluateConditionTree`; (6) upgrade the builder UI. REST/GraphQL rule CRUD already round-trips the `conditions` JSON unchanged (it is an opaque blob to the SPs), so **no route, repository, or SP change is required** — the richer shape flows through transparently.

**Tech Stack:** TypeScript pure modules; `vitest` (`--project unit` for the evaluator/adapter, `--project integration` for the OR-group rule firing); `mssql` via `execSpOne` (only indirectly, through the reused PQL parser is in-memory — no new SP); BullMQ `automation` worker (from 6a); Next.js App Router (SSR) + `next-intl` (en + id, real Indonesian) for the builder; Playwright e2e optional headline. DB work (the one integration test) runs **ONLY against local Docker `ProjectFlow_Test`**, never the prod-pointing `apps/api/.env`.

**Prerequisite:** **Phase 6a merged** (engine fires; taxonomy/scope/runs in place) — i.e. `emitAutomationEvent` enqueues scope-matched jobs, `automation.worker.ts` loads the rule and writes an `AutomationRuns` row, and the BUILD_PLAN taxonomy rename (`TASK_CREATED`/`STATUS_CHANGED`/`CHANGE_STATUS`/`ASSIGN`/…) is live in `@projectflow/types`, the route schemas, and the frontend label maps. This plan references the 6a names where they differ from the legacy `0009` names; if 6a renamed `evaluateConditions`'s call site, keep this slice consistent with that.

---

## File Structure

**Types** (`packages/types/`)
- `index.ts` — **Modify.** Add the recursive `ConditionNode` union + `ConditionGroupOp` (`'AND' | 'OR'`) + `ConditionOperator` (the 8 operator tokens) + `ConditionLeaf` alongside the kept legacy `AutomationCondition`. Extend `AutomationRule.conditions` to accept the tree (typed as `AutomationCondition[] | ConditionNode` for backward compatibility). No removals.

**API — condition engine** (`apps/api/src/modules/automation/`)
- `condition.tree.ts` — **Create.** Pure, IO-free core: `parseConditionTree(stored)` (legacy-flat → implicit `AND`; passthrough for an already-tree value), `evaluateConditionTree(node, ctx)` (recursive AND/OR walk + per-`Operator` leaf comparison), the `ConditionContext` shape, and `compareOperator(operator, actual, expected)`. Resolvers for filter/role are supplied on `ctx` (injected, so the module stays pure and testable).
- `condition.context.ts` — **Create.** `buildConditionContext(payload, resolvers)` — maps the 6a event payload (`task`/`taskBefore`/`actorId`/`workspaceId`/`comment`) into a `ConditionContext` and binds the real `matchesFilter` (PQL) + `userHasRole` (RBAC) resolvers.
- `condition.resolvers.ts` — **Create.** The two real IO-backed resolvers: `matchesFilterPQL(pql, task, actorId)` (reuses `parsePQL` and matches the parsed filter against the task in memory) and `userHasRolePQL`→`userHasRole(userId, workspaceId, roleSlug)` (reuses `roleService.listUserRoles`).
- `automation.conditions.ts` — **Modify.** Re-export `evaluateConditionTree`/`parseConditionTree` and keep `evaluateConditions(conditions, payload)` as a thin sync legacy shim that wraps the tree evaluator with no-op (false) async resolvers (so any non-worker caller still type-checks). Remove the `ISSUE_MATCHES_FILTER`/`USER_HAS_ROLE` `return true` stubs.
- `automation.worker.ts` — **Modify.** Replace the `evaluateConditions(rule.conditions, payload)` call with `await evaluateConditionTree(parseConditionTree(rule.conditions), buildConditionContext(payload, resolvers))`; when conditions are not met, record the 6a `AutomationRuns` `skipped` row (consistent with the 6a audit pattern).

**Frontend** (`apps/next-web/src/`)
- `app/(app)/automations/automations-view.tsx` — **Modify.** Replace the flat `ConditionList` with a recursive `ConditionGroupEditor` (AND/OR toggle + nested groups + per-leaf operator dropdown), add an `OPERATOR_KEYS` label map and a `GROUP_OP_KEYS` map, and migrate the dialog's `conditions` state from `AutomationCondition[]` to a `ConditionNode` (seeding legacy arrays through `parseConditionTreeClient`). The on-submit payload sends the `ConditionNode` (the server action + REST already pass `conditions` opaque).
- `lib/conditionTree.ts` — **Create.** A tiny client mirror of `parseConditionTree` (legacy-flat → implicit AND) so the editor can open existing rules without importing API-only code.
- `messages/en.json` *(actual path `apps/next-web/messages/en.json`)* — **Modify.** Add operator labels, AND/OR group labels, and the upgraded condition-builder strings under the existing `Automations` namespace.
- `messages/id.json` *(actual path `apps/next-web/messages/id.json`)* — **Modify.** Same keys, real Indonesian.

**Tests**
- `apps/api/src/modules/automation/__tests__/condition-tree.unit.test.ts` — **Create.** Pure evaluator: each operator; nested AND/OR include/exclude; legacy-flat compatibility; `is_set`/missing-field edge cases; injected filter/role resolver wiring.
- `apps/api/src/modules/automation/__tests__/condition-resolvers.unit.test.ts` — **Create.** Pure PQL-filter matching against an in-memory task; role-check resolver against a stubbed `listUserRoles`.
- `apps/api/src/modules/automation/__tests__/or-group.integration.test.ts` — **Create.** A rule with a top-level `OR` group fires for **either** branch and **not** when neither matches (writes/asserts the 6a `AutomationRuns` row).
- `apps/next-web/e2e/automation-conditions.spec.ts` — **Create (optional headline).** Build an OR-group rule in the upgraded builder, save it, and confirm it round-trips (re-open shows the OR group + operators).

---

## Tasks

### Task 1: Recursive condition model in `@projectflow/types`

**Files:**
- Modify: `packages/types/index.ts` (the `// ── Automation Engine ──` block, lines ~378–451)
- Test: type-only; verified by `tsc` in this task and exercised by Task 2's unit tests.

Steps:

- [ ] Add the recursive model **after** the existing `AutomationCondition` interface (keep `AutomationConditionType` and `AutomationCondition` exactly as-is — they remain the leaf payload shape and the legacy stored form). Insert:

```ts
// ── Recursive condition tree (Phase 6b) ───────────────────────────────────────
// A rule's conditions are now a recursive AND/OR group of leaves. A legacy flat
// AutomationCondition[] is read as an implicit top-level AND group (no migration).

export type ConditionGroupOp = 'AND' | 'OR';

export type ConditionOperator =
  | 'is'
  | 'is_not'
  | 'contains'
  | 'gt'
  | 'lt'
  | 'before'
  | 'after'
  | 'is_set';

/** A single comparison. `type` carries the legacy condition kind; FIELD-style
 *  leaves use `field`/`operator`/`value`, while ISSUE_MATCHES_FILTER uses `pql`
 *  and USER_HAS_ROLE uses `value` (the role slug). */
export interface ConditionLeaf {
  type:     AutomationConditionType;
  field?:   string;
  operator: ConditionOperator;
  value?:   string;
  /** ISSUE_MATCHES_FILTER only. */
  pql?:     string;
}

export interface ConditionGroup {
  op:       ConditionGroupOp;
  children: ConditionNode[];
}

export type ConditionNode = ConditionGroup | ConditionLeaf;

/** Type guard: a group node has an `op` + `children`. */
export function isConditionGroup(node: ConditionNode): node is ConditionGroup {
  return (node as ConditionGroup).op === 'AND' || (node as ConditionGroup).op === 'OR';
}
```

- [ ] Widen `AutomationRule.conditions` so both the legacy array and the new tree type-check (the stored JSON is read through the adapter either way):

```ts
export interface AutomationRule {
  id: string;
  projectId: string;
  name: string;
  isEnabled: boolean;
  trigger: AutomationTriggerConfig;
  /** Legacy flat array OR a recursive AND/OR tree (Phase 6b). Read via
   *  parseConditionTree() which normalises a flat array to an implicit AND. */
  conditions: AutomationCondition[] | ConditionNode;
  actions: AutomationAction[];
  executionCount: number;
  lastExecutedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] Run: `npm run build --workspace packages/types`. Expected: PASS — no type errors; the new exports compile.

- [ ] Commit:
```
git add packages/types/index.ts
git commit -m "feat(6b): recursive ConditionNode/Operator model in @projectflow/types"
```

---

### Task 2: Pure tree evaluator + legacy adapter (`condition.tree.ts`) + unit tests

**Files:**
- Create: `apps/api/src/modules/automation/condition.tree.ts`
- Create: `apps/api/src/modules/automation/__tests__/condition-tree.unit.test.ts`

Steps:

- [ ] Write the failing unit test first. It covers every `Operator`, nested AND/OR include/exclude, legacy-flat compatibility, `is_set`, and the injected `matchesFilter`/`userHasRole` resolvers:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  evaluateConditionTree,
  parseConditionTree,
  compareOperator,
  type ConditionContext,
} from '../condition.tree.js';
import type { ConditionNode, ConditionLeaf } from '@projectflow/types';

function ctx(over: Partial<ConditionContext> = {}): ConditionContext {
  return {
    fields: { priority: 'HIGH', status: 'In Progress', assigneeId: 'u-1', storyPoints: 5, dueDate: '2026-06-10T00:00:00.000Z' },
    matchesFilter: async () => false,
    userHasRole:   async () => false,
    ...over,
  };
}

const leaf = (l: Partial<ConditionLeaf>): ConditionLeaf =>
  ({ type: 'FIELD_EQUALS', operator: 'is', ...l }) as ConditionLeaf;

describe('compareOperator', () => {
  it('is / is_not', () => {
    expect(compareOperator('is', 'HIGH', 'HIGH')).toBe(true);
    expect(compareOperator('is', 'HIGH', 'LOW')).toBe(false);
    expect(compareOperator('is_not', 'HIGH', 'LOW')).toBe(true);
    expect(compareOperator('is_not', 'HIGH', 'HIGH')).toBe(false);
  });
  it('contains (case-insensitive substring)', () => {
    expect(compareOperator('contains', 'In Progress', 'progress')).toBe(true);
    expect(compareOperator('contains', 'Done', 'progress')).toBe(false);
  });
  it('gt / lt (numeric)', () => {
    expect(compareOperator('gt', 5, '3')).toBe(true);
    expect(compareOperator('gt', 2, '3')).toBe(false);
    expect(compareOperator('lt', 2, '3')).toBe(true);
    expect(compareOperator('lt', 5, '3')).toBe(false);
  });
  it('before / after (date)', () => {
    expect(compareOperator('before', '2026-06-10T00:00:00Z', '2026-06-11')).toBe(true);
    expect(compareOperator('before', '2026-06-12T00:00:00Z', '2026-06-11')).toBe(false);
    expect(compareOperator('after',  '2026-06-12T00:00:00Z', '2026-06-11')).toBe(true);
    expect(compareOperator('after',  '2026-06-10T00:00:00Z', '2026-06-11')).toBe(false);
  });
  it('is_set (present & non-empty)', () => {
    expect(compareOperator('is_set', 'u-1', undefined)).toBe(true);
    expect(compareOperator('is_set', '',   undefined)).toBe(false);
    expect(compareOperator('is_set', null, undefined)).toBe(false);
    expect(compareOperator('is_set', undefined, undefined)).toBe(false);
  });
});

describe('evaluateConditionTree — leaves', () => {
  it('a FIELD leaf reads ctx.fields[field]', async () => {
    const node = leaf({ field: 'priority', operator: 'is', value: 'HIGH' });
    expect(await evaluateConditionTree(node, ctx())).toBe(true);
    expect(await evaluateConditionTree(leaf({ field: 'priority', operator: 'is', value: 'LOW' }), ctx())).toBe(false);
  });
  it('a missing field is treated as unset (is_set=false, is=false)', async () => {
    expect(await evaluateConditionTree(leaf({ field: 'nope', operator: 'is_set' }), ctx())).toBe(false);
    expect(await evaluateConditionTree(leaf({ field: 'nope', operator: 'is', value: 'x' }), ctx())).toBe(false);
  });
  it('ISSUE_MATCHES_FILTER delegates to ctx.matchesFilter', async () => {
    const matchesFilter = vi.fn(async () => true);
    const node = leaf({ type: 'ISSUE_MATCHES_FILTER', operator: 'is', pql: 'priority = HIGH' });
    expect(await evaluateConditionTree(node, ctx({ matchesFilter }))).toBe(true);
    expect(matchesFilter).toHaveBeenCalledWith('priority = HIGH');
  });
  it('USER_HAS_ROLE delegates to ctx.userHasRole with the role slug', async () => {
    const userHasRole = vi.fn(async () => true);
    const node = leaf({ type: 'USER_HAS_ROLE', operator: 'is', value: 'workspace-admin' });
    expect(await evaluateConditionTree(node, ctx({ userHasRole }))).toBe(true);
    expect(userHasRole).toHaveBeenCalledWith('workspace-admin');
  });
});

describe('evaluateConditionTree — groups', () => {
  const hi  = leaf({ field: 'priority', operator: 'is', value: 'HIGH' });
  const lo  = leaf({ field: 'priority', operator: 'is', value: 'LOW' });
  const ip  = leaf({ field: 'status',   operator: 'is', value: 'In Progress' });

  it('AND requires all', async () => {
    expect(await evaluateConditionTree({ op: 'AND', children: [hi, ip] }, ctx())).toBe(true);
    expect(await evaluateConditionTree({ op: 'AND', children: [hi, lo] }, ctx())).toBe(false);
  });
  it('OR requires any (fires for either branch, not otherwise)', async () => {
    expect(await evaluateConditionTree({ op: 'OR', children: [lo, ip] }, ctx())).toBe(true); // ip matches
    expect(await evaluateConditionTree({ op: 'OR', children: [lo, hi] }, ctx())).toBe(true); // hi matches
    expect(await evaluateConditionTree({ op: 'OR', children: [lo, leaf({ field: 'status', operator: 'is', value: 'Done' })] }, ctx())).toBe(false);
  });
  it('nested OR-inside-AND', async () => {
    const node: ConditionNode = { op: 'AND', children: [ip, { op: 'OR', children: [hi, lo] }] };
    expect(await evaluateConditionTree(node, ctx())).toBe(true);  // status=In Progress AND (HIGH or LOW) → HIGH
  });
  it('an empty group is vacuously true (rule fires for every event)', async () => {
    expect(await evaluateConditionTree({ op: 'AND', children: [] }, ctx())).toBe(true);
    expect(await evaluateConditionTree({ op: 'OR',  children: [] }, ctx())).toBe(true);
  });
});

describe('parseConditionTree — legacy compatibility', () => {
  it('wraps a legacy flat array in an implicit top-level AND', () => {
    const legacy = [
      { type: 'FIELD_EQUALS' as const, field: 'priority', value: 'HIGH' },
      { type: 'FIELD_NOT_EQUALS' as const, field: 'status', value: 'Done' },
    ];
    const tree = parseConditionTree(legacy);
    expect(tree).toEqual({
      op: 'AND',
      children: [
        { type: 'FIELD_EQUALS', field: 'priority', operator: 'is', value: 'HIGH' },
        { type: 'FIELD_NOT_EQUALS', field: 'status', operator: 'is_not', value: 'Done' },
      ],
    });
  });
  it('maps legacy IN_SPRINT/NOT_IN_SPRINT to is_set/!is_set on sprintId', () => {
    const tree = parseConditionTree([{ type: 'IN_SPRINT' as const }]);
    expect(tree).toEqual({ op: 'AND', children: [{ type: 'IN_SPRINT', field: 'sprintId', operator: 'is_set' }] });
  });
  it('passes an already-tree value through unchanged', () => {
    const node = { op: 'OR' as const, children: [{ type: 'FIELD_EQUALS' as const, operator: 'is' as const, field: 'p', value: 'x' }] };
    expect(parseConditionTree(node)).toBe(node);
  });
  it('an empty array becomes an empty AND group', () => {
    expect(parseConditionTree([])).toEqual({ op: 'AND', children: [] });
  });
});
```

- [ ] Run: `npm test --workspace apps/api -- condition-tree`. Expected: FAIL — `Cannot find module '../condition.tree.js'`.

- [ ] Write `apps/api/src/modules/automation/condition.tree.ts` (pure, IO-free core; resolvers injected via `ctx`):

```ts
/**
 * Pure automation condition engine (Phase 6b).
 *
 * Evaluates a recursive AND/OR ConditionNode against a ConditionContext.
 * No IO lives here: the two checks that need data (ISSUE_MATCHES_FILTER,
 * USER_HAS_ROLE) are supplied as async resolvers on the context, so the
 * tree walk + operator comparisons are fully unit-testable in isolation.
 *
 * A legacy flat AutomationCondition[] is normalised to an implicit top-level
 * AND group by parseConditionTree() — no data migration is required.
 */
import {
  isConditionGroup,
  type AutomationCondition,
  type ConditionLeaf,
  type ConditionNode,
  type ConditionOperator,
} from '@projectflow/types';

/** The evaluation context: flattened task fields + injected IO resolvers. */
export interface ConditionContext {
  /** Field name → current value (priority, status, assigneeId, storyPoints, dueDate, sprintId, …). */
  fields: Record<string, unknown>;
  /** ISSUE_MATCHES_FILTER — true if the task matches the PQL expression. */
  matchesFilter: (pql: string) => Promise<boolean>;
  /** USER_HAS_ROLE — true if the actor holds the given role slug. */
  userHasRole: (roleSlug: string) => Promise<boolean>;
}

/** Compare a single leaf's actual value against its expected value with an operator. */
export function compareOperator(
  operator: ConditionOperator,
  actual: unknown,
  expected: string | undefined,
): boolean {
  switch (operator) {
    case 'is':
      return String(actual ?? '') === String(expected ?? '');
    case 'is_not':
      return String(actual ?? '') !== String(expected ?? '');
    case 'contains':
      return String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
    case 'gt': {
      const a = Number(actual), e = Number(expected);
      return Number.isFinite(a) && Number.isFinite(e) && a > e;
    }
    case 'lt': {
      const a = Number(actual), e = Number(expected);
      return Number.isFinite(a) && Number.isFinite(e) && a < e;
    }
    case 'before': {
      const a = Date.parse(String(actual)), e = Date.parse(String(expected));
      return Number.isFinite(a) && Number.isFinite(e) && a < e;
    }
    case 'after': {
      const a = Date.parse(String(actual)), e = Date.parse(String(expected));
      return Number.isFinite(a) && Number.isFinite(e) && a > e;
    }
    case 'is_set':
      return actual !== undefined && actual !== null && String(actual) !== '';
    default:
      return false;
  }
}

/** Evaluate one leaf against the context. */
async function evaluateLeaf(leaf: ConditionLeaf, ctx: ConditionContext): Promise<boolean> {
  switch (leaf.type) {
    case 'ISSUE_MATCHES_FILTER':
      return leaf.pql ? ctx.matchesFilter(leaf.pql) : false;
    case 'USER_HAS_ROLE':
      return leaf.value ? ctx.userHasRole(leaf.value) : false;
    default: {
      const actual = leaf.field ? ctx.fields[leaf.field] : undefined;
      return compareOperator(leaf.operator, actual, leaf.value);
    }
  }
}

/**
 * Recursively evaluate a ConditionNode. AND = every child true; OR = any child
 * true. An empty group is vacuously true (a rule with no conditions fires on
 * every event — matches the legacy "no conditions" semantics).
 */
export async function evaluateConditionTree(node: ConditionNode, ctx: ConditionContext): Promise<boolean> {
  if (isConditionGroup(node)) {
    if (node.children.length === 0) return true;
    if (node.op === 'AND') {
      for (const child of node.children) {
        if (!(await evaluateConditionTree(child, ctx))) return false;
      }
      return true;
    }
    // OR
    for (const child of node.children) {
      if (await evaluateConditionTree(child, ctx)) return true;
    }
    return false;
  }
  return evaluateLeaf(node, ctx);
}

/** Default operator for a legacy leaf that predates the operator field. */
function legacyOperator(c: AutomationCondition): ConditionOperator {
  switch (c.type) {
    case 'FIELD_NOT_EQUALS': return 'is_not';
    case 'NOT_IN_SPRINT':    return 'is_set'; // negated below by remapping to is_not on a sentinel
    case 'IN_SPRINT':        return 'is_set';
    default:                 return 'is';
  }
}

/** Convert a single legacy condition into a leaf node. */
function legacyToLeaf(c: AutomationCondition): ConditionLeaf {
  if (c.type === 'IN_SPRINT')     return { type: 'IN_SPRINT',     field: 'sprintId', operator: 'is_set' };
  if (c.type === 'NOT_IN_SPRINT') return { type: 'NOT_IN_SPRINT', field: 'sprintId', operator: 'is_not', value: '__SET__' };
  return {
    type:     c.type,
    field:    c.field,
    operator: legacyOperator(c),
    value:    c.value,
    pql:      c.pql,
  };
}

/**
 * Normalise stored conditions to a canonical ConditionNode.
 * - A legacy flat AutomationCondition[] → implicit top-level AND group.
 * - An already-tree value → returned unchanged.
 */
export function parseConditionTree(stored: AutomationCondition[] | ConditionNode): ConditionNode {
  if (Array.isArray(stored)) {
    return { op: 'AND', children: stored.map(legacyToLeaf) };
  }
  return stored;
}
```

> NOTE — `NOT_IN_SPRINT` is the one legacy type whose semantics are "field is NOT set". The cleanest mapping under the operator model is an `is_not` against a "is_set" sentinel, but to keep `compareOperator` honest we special-case it in `evaluateLeaf` only if needed. Simpler and correct: keep `NOT_IN_SPRINT` mapped to `is_set` but have the leaf evaluator invert it. The unit test above asserts `IN_SPRINT → is_set`; add the matching `NOT_IN_SPRINT` assertion + the inversion in `evaluateLeaf` as the next step.

- [ ] Add the `NOT_IN_SPRINT` inversion to `evaluateLeaf` (so the negation is explicit, not a sentinel value), and simplify `legacyToLeaf` to drop the `'__SET__'` hack:

```ts
// in legacyToLeaf:
if (c.type === 'NOT_IN_SPRINT') return { type: 'NOT_IN_SPRINT', field: 'sprintId', operator: 'is_set' };

// in evaluateLeaf default branch (before compareOperator), add:
//   const set = compareOperator('is_set', actual, undefined);
//   if (leaf.type === 'IN_SPRINT')     return set;
//   if (leaf.type === 'NOT_IN_SPRINT') return !set;
```

Concretely, replace the `default` case of `evaluateLeaf` with:

```ts
    default: {
      const actual = leaf.field ? ctx.fields[leaf.field] : undefined;
      if (leaf.type === 'IN_SPRINT')     return compareOperator('is_set', actual, undefined);
      if (leaf.type === 'NOT_IN_SPRINT') return !compareOperator('is_set', actual, undefined);
      return compareOperator(leaf.operator, actual, leaf.value);
    }
```

…and add to `condition-tree.unit.test.ts`:

```ts
  it('IN_SPRINT / NOT_IN_SPRINT honour sprintId presence', async () => {
    const withSprint    = ctx({ fields: { sprintId: 's-1' } });
    const withoutSprint = ctx({ fields: {} });
    expect(await evaluateConditionTree(leaf({ type: 'IN_SPRINT',     field: 'sprintId', operator: 'is_set' }), withSprint)).toBe(true);
    expect(await evaluateConditionTree(leaf({ type: 'IN_SPRINT',     field: 'sprintId', operator: 'is_set' }), withoutSprint)).toBe(false);
    expect(await evaluateConditionTree(leaf({ type: 'NOT_IN_SPRINT', field: 'sprintId', operator: 'is_set' }), withoutSprint)).toBe(true);
    expect(await evaluateConditionTree(leaf({ type: 'NOT_IN_SPRINT', field: 'sprintId', operator: 'is_set' }), withSprint)).toBe(false);
  });
```

(And fix the `NOT_IN_SPRINT` expectation in the `parseConditionTree` test to `{ type: 'NOT_IN_SPRINT', field: 'sprintId', operator: 'is_set' }`.)

- [ ] Run: `npm test --workspace apps/api -- condition-tree`. Expected: PASS (all operator, group, leaf, legacy-adapter, and sprint tests green).

- [ ] Commit:
```
git add apps/api/src/modules/automation/condition.tree.ts apps/api/src/modules/automation/__tests__/condition-tree.unit.test.ts
git commit -m "feat(6b): pure evaluateConditionTree + operators + legacy-flat adapter + unit tests"
```

---

### Task 3: Real filter (PQL) + role (RBAC) resolvers + unit tests

**Files:**
- Create: `apps/api/src/modules/automation/condition.resolvers.ts`
- Create: `apps/api/src/modules/automation/__tests__/condition-resolvers.unit.test.ts`

Steps:

- [ ] Write the failing unit test first. `matchesFilterPQL` matches a parsed PQL against an in-memory task; `userHasRole` checks a stubbed `listUserRoles` result:

```ts
import { describe, it, expect, vi } from 'vitest';
import { matchesFilterPQL, makeUserHasRole, type FilterTask } from '../condition.resolvers.js';

const task: FilterTask = {
  status: 'In Progress',
  priority: 'HIGH',
  type: 'TASK',
  assigneeId: 'u-1',
  reporterId: 'u-2',
  sprintId: 's-1',
  dueDate: '2026-06-10T00:00:00.000Z',
  title: 'Fix the login bug',
};

describe('matchesFilterPQL', () => {
  it('matches a simple equality filter', () => {
    expect(matchesFilterPQL('priority = HIGH', task, 'u-9')).toBe(true);
    expect(matchesFilterPQL('priority = LOW',  task, 'u-9')).toBe(false);
  });
  it('matches status (free text in PQL keeps case)', () => {
    expect(matchesFilterPQL('status = "In Progress"', task, 'u-9')).toBe(true);
  });
  it('ANDs multiple clauses', () => {
    expect(matchesFilterPQL('priority = HIGH AND status = "In Progress"', task, 'u-9')).toBe(true);
    expect(matchesFilterPQL('priority = HIGH AND status = "Done"',        task, 'u-9')).toBe(false);
  });
  it('resolves currentUser() against the supplied actorId', () => {
    expect(matchesFilterPQL('assignee = currentUser()', task, 'u-1')).toBe(true);
    expect(matchesFilterPQL('assignee = currentUser()', task, 'u-9')).toBe(false);
  });
  it('matches a free-text term against the title', () => {
    expect(matchesFilterPQL('login', task, 'u-9')).toBe(true);
    expect(matchesFilterPQL('logout', task, 'u-9')).toBe(false);
  });
  it('an empty PQL matches everything', () => {
    expect(matchesFilterPQL('', task, 'u-9')).toBe(true);
  });
});

describe('makeUserHasRole', () => {
  it('is true when the user holds the role slug in the workspace', async () => {
    const listUserRoles = vi.fn(async () => [{ roleSlug: 'workspace-admin' }, { roleSlug: 'member' }]);
    const userHasRole = makeUserHasRole(listUserRoles as any, 'u-1', 'ws-1');
    expect(await userHasRole('workspace-admin')).toBe(true);
    expect(listUserRoles).toHaveBeenCalledWith('u-1', 'ws-1');
  });
  it('is false when the user lacks the role', async () => {
    const listUserRoles = vi.fn(async () => [{ roleSlug: 'member' }]);
    const userHasRole = makeUserHasRole(listUserRoles as any, 'u-1', 'ws-1');
    expect(await userHasRole('workspace-admin')).toBe(false);
  });
  it('is false (fail-closed) when there is no actor', async () => {
    const listUserRoles = vi.fn(async () => [{ roleSlug: 'workspace-admin' }]);
    const userHasRole = makeUserHasRole(listUserRoles as any, null, 'ws-1');
    expect(await userHasRole('workspace-admin')).toBe(false);
    expect(listUserRoles).not.toHaveBeenCalled();
  });
});
```

- [ ] Run: `npm test --workspace apps/api -- condition-resolvers`. Expected: FAIL — `Cannot find module '../condition.resolvers.js'`.

- [ ] Write `apps/api/src/modules/automation/condition.resolvers.ts` (reuses `parsePQL`; matches the parsed filter against the task in memory — no DB round-trip, which keeps the evaluator pure and fast):

```ts
/**
 * Real IO-backed resolvers for the two condition kinds that need data:
 *   - ISSUE_MATCHES_FILTER → reuse the PQL parser and match the parsed filter
 *     against the event's task in memory.
 *   - USER_HAS_ROLE        → reuse the roles service (listUserRoles) to check
 *     whether the actor holds a role slug in the rule's workspace.
 */
import { parsePQL, type ParsedPQL } from '../search/pql.parser.js';

/** The subset of a task the PQL matcher inspects. */
export interface FilterTask {
  status?:     string | null;
  priority?:   string | null;
  type?:       string | null;
  assigneeId?: string | null;
  reporterId?: string | null;
  sprintId?:   string | null;
  dueDate?:    string | null;
  title?:      string | null;
}

function eqi(a: unknown, b: unknown): boolean {
  return String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
}

/** Evaluate a ParsedPQL against a task in memory. Every set field must match (AND). */
function matchesParsed(p: ParsedPQL, task: FilterTask): boolean {
  if (p.status   !== undefined && !eqi(task.status,   p.status))   return false;
  if (p.priority !== undefined && !eqi(task.priority, p.priority)) return false;
  if (p.type     !== undefined && !eqi(task.type,     p.type))     return false;
  if (p.assigneeId !== undefined && task.assigneeId !== p.assigneeId) return false;
  if (p.reporterId !== undefined && task.reporterId !== p.reporterId) return false;
  if (p.sprintId   !== undefined && task.sprintId   !== p.sprintId)   return false;
  if (p.q !== undefined && !String(task.title ?? '').toLowerCase().includes(p.q.toLowerCase())) return false;
  if (p.dueAfter  !== undefined) {
    const d = Date.parse(String(task.dueDate));
    if (!Number.isFinite(d) || d < Date.parse(p.dueAfter)) return false;
  }
  if (p.dueBefore !== undefined) {
    const d = Date.parse(String(task.dueDate));
    if (!Number.isFinite(d) || d > Date.parse(p.dueBefore)) return false;
  }
  return true;
}

/** ISSUE_MATCHES_FILTER resolver — true if the task matches the PQL expression. */
export function matchesFilterPQL(pql: string, task: FilterTask, actorId: string | null): boolean {
  if (!pql?.trim()) return true; // an empty filter matches everything
  const parsed = parsePQL(pql, actorId ?? undefined);
  return matchesParsed(parsed, task);
}

/** Shape of one role assignment row we care about (from roleService.listUserRoles). */
interface RoleAssignmentLike { roleSlug: string }

/**
 * Build a USER_HAS_ROLE resolver bound to an actor + workspace. Fails closed
 * (returns false) when there is no actor.
 */
export function makeUserHasRole(
  listUserRoles: (userId: string, workspaceId?: string | null) => Promise<RoleAssignmentLike[]>,
  actorId: string | null,
  workspaceId: string | null,
): (roleSlug: string) => Promise<boolean> {
  return async (roleSlug: string) => {
    if (!actorId) return false;
    const roles = await listUserRoles(actorId, workspaceId);
    return roles.some((r) => r.roleSlug === roleSlug);
  };
}
```

- [ ] Run: `npm test --workspace apps/api -- condition-resolvers`. Expected: PASS (filter + role resolver tests green).

- [ ] Commit:
```
git add apps/api/src/modules/automation/condition.resolvers.ts apps/api/src/modules/automation/__tests__/condition-resolvers.unit.test.ts
git commit -m "feat(6b): real ISSUE_MATCHES_FILTER (PQL) + USER_HAS_ROLE (RBAC) resolvers + unit tests"
```

---

### Task 4: Context builder + legacy shim (`condition.context.ts`, `automation.conditions.ts`)

**Files:**
- Create: `apps/api/src/modules/automation/condition.context.ts`
- Modify: `apps/api/src/modules/automation/automation.conditions.ts`

Steps:

- [ ] Write `apps/api/src/modules/automation/condition.context.ts` — maps the 6a event payload into a `ConditionContext` and binds the real resolvers. (The 6a payload carries the typed event values: the after-state `task`, the actor id, and the rule's workspace id; `comment` is present for `COMMENT_POSTED`.)

```ts
/**
 * Build a ConditionContext from a 6a automation event payload, binding the real
 * PQL-filter and RBAC role resolvers. Keeps the pure tree evaluator IO-free.
 */
import type { ConditionContext } from './condition.tree.js';
import { matchesFilterPQL, makeUserHasRole, type FilterTask } from './condition.resolvers.js';
import { roleService } from '../roles/role.service.js';

/** The slice of the 6a job payload the condition engine reads. */
export interface AutomationEventPayload {
  taskId?:       string;
  workspaceId?:  string;
  actorId?:      string;
  /** After-state task fields the engine compares against. */
  status?:       string | null;
  priority?:     string | null;
  type?:         string | null;
  assigneeId?:   string | null;
  reporterId?:   string | null;
  sprintId?:     string | null;
  dueDate?:      string | null;
  storyPoints?:  number | null;
  title?:        string | null;
  /** STATUS_CHANGED carries the prior status; FIELD_CHANGED carries field/from/to. */
  fromStatus?:   string | null;
  toStatus?:     string | null;
  field?:        string | null;
  from?:         string | null;
  to?:           string | null;
  [key: string]: unknown;
}

/** Flatten the payload into the field map the FIELD leaves read. */
function toFields(p: AutomationEventPayload): Record<string, unknown> {
  return {
    status:      p.status      ?? p.toStatus ?? null,
    priority:    p.priority    ?? null,
    type:        p.type        ?? null,
    assigneeId:  p.assigneeId  ?? null,
    reporterId:  p.reporterId  ?? null,
    sprintId:    p.sprintId    ?? null,
    dueDate:     p.dueDate     ?? null,
    storyPoints: p.storyPoints ?? null,
    title:       p.title       ?? null,
    // change-event extras (for FIELD_CHANGED / STATUS_CHANGED conditions)
    fromStatus:  p.fromStatus  ?? null,
    field:       p.field       ?? null,
    from:        p.from        ?? null,
    to:          p.to          ?? null,
    // expose the raw payload value for any other field name a user typed
    ...p,
  };
}

function toFilterTask(p: AutomationEventPayload): FilterTask {
  return {
    status:     p.status     ?? p.toStatus ?? null,
    priority:   p.priority   ?? null,
    type:       p.type       ?? null,
    assigneeId: p.assigneeId ?? null,
    reporterId: p.reporterId ?? null,
    sprintId:   p.sprintId   ?? null,
    dueDate:    p.dueDate    ?? null,
    title:      p.title      ?? null,
  };
}

export function buildConditionContext(payload: AutomationEventPayload): ConditionContext {
  const actorId     = (payload.actorId     as string | undefined) ?? null;
  const workspaceId = (payload.workspaceId as string | undefined) ?? null;
  const filterTask  = toFilterTask(payload);

  return {
    fields:        toFields(payload),
    matchesFilter: async (pql) => matchesFilterPQL(pql, filterTask, actorId),
    userHasRole:   makeUserHasRole(roleService.listUserRoles, actorId, workspaceId),
  };
}
```

- [ ] Modify `automation.conditions.ts` — re-export the new engine and reduce the legacy `evaluateConditions` to a thin shim (so any caller other than the worker still type-checks; the stub `return true` for filter/role is gone — the shim wires no-op resolvers that fail closed). Replace the whole file:

```ts
/**
 * Automation condition evaluation entry points.
 *
 * Phase 6b: the real engine is the pure, recursive evaluateConditionTree in
 * condition.tree.ts. This module re-exports it + parseConditionTree, and keeps a
 * synchronous legacy `evaluateConditions(conditions, payload)` shim for any
 * non-worker caller — it evaluates the tree with fail-closed (false) resolvers,
 * so legacy callers behave exactly like the old FIELD-only evaluator and never
 * silently pass an unmet ISSUE_MATCHES_FILTER / USER_HAS_ROLE.
 */
import type { AutomationCondition } from '@projectflow/types';
import {
  evaluateConditionTree,
  parseConditionTree,
  type ConditionContext,
} from './condition.tree.js';

export { evaluateConditionTree, parseConditionTree } from './condition.tree.js';
export type { ConditionContext } from './condition.tree.js';

/**
 * @deprecated Use evaluateConditionTree(parseConditionTree(conditions), ctx).
 * Synchronous legacy adapter: evaluates the FIELD/group logic with fail-closed
 * filter/role resolvers. Returns a boolean (no IO is awaited because the no-op
 * resolvers resolve immediately and the FIELD path is synchronous).
 */
export function evaluateConditions(
  conditions: AutomationCondition[],
  payload: Record<string, unknown>,
): boolean {
  const ctx: ConditionContext = {
    fields:        payload,
    matchesFilter: async () => false,
    userHasRole:   async () => false,
  };
  let result = false;
  // The tree promise resolves synchronously for the FIELD-only path; we coerce
  // via a resolved flag because evaluateConditionTree returns a Promise.
  void evaluateConditionTree(parseConditionTree(conditions), ctx).then((r) => { result = r; });
  return result;
}
```

> NOTE — the synchronous coercion above is unreliable (the `.then` runs after the function returns). Because the only real caller (the worker) is converted to `await evaluateConditionTree(...)` in Task 5, **prefer deleting the legacy `evaluateConditions` export entirely** and updating any stray import. Grep first: `npm exec --workspace apps/api -- tsc --noEmit` will surface any remaining importer. If grep shows the worker is the only importer, delete the shim and skip the unreliable sync wrapper.

- [ ] Resolve the shim decision: run a search for `evaluateConditions(` across `apps/api/src`. If the **worker is the only caller**, remove the `evaluateConditions` export from `automation.conditions.ts` (keep only the re-exports of `evaluateConditionTree`/`parseConditionTree`/`ConditionContext`). If another caller exists, convert it to `await evaluateConditionTree(parseConditionTree(...), buildConditionContext(...))` rather than keeping the sync shim.

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: PASS — no type errors (after the worker is updated in Task 5 this stays green; if running strictly task-by-task, the worker still imports `evaluateConditions` here until Task 5, so keep the re-export until then OR do Tasks 4+5 together).

- [ ] Commit:
```
git add apps/api/src/modules/automation/condition.context.ts apps/api/src/modules/automation/automation.conditions.ts
git commit -m "feat(6b): condition context builder (payload→fields + real resolvers) + legacy shim cleanup"
```

---

### Task 5: Wire the worker to the tree evaluator

**Files:**
- Modify: `apps/api/src/modules/automation/automation.worker.ts`

Steps:

- [ ] Replace the condition-evaluation block in `automation.worker.ts`. Swap the `evaluateConditions(rule.conditions, payload)` import + call for the tree evaluator, and (consistent with the 6a `AutomationRuns` audit) record a `skipped` run when conditions are not met. The minimal diff to the worker body:

```ts
import { Worker } from 'bullmq';
import { AutomationRepository } from './automation.repository.js';
import { evaluateConditionTree, parseConditionTree } from './automation.conditions.js';
import { buildConditionContext } from './condition.context.js';
import { executeAction }        from './automation.actions.js';
import type { AutomationJobData } from './automation.queue.js';
import { subLogger } from '../../shared/lib/logger.js';
import { registerCloser } from '../../shared/lib/shutdown.js';

const log = subLogger('automation');
const repo = new AutomationRepository();

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
};

export function startAutomationWorker() {
  const worker = new Worker<AutomationJobData>(
    'automation',
    async (job) => {
      const { ruleId, payload } = job.data;

      const rules = await repo.list(job.data.projectId);
      const rule  = rules.find((r) => r.id === ruleId);
      if (!rule || !rule.isEnabled) return; // disabled/deleted since enqueue

      // Phase 6b: evaluate the recursive AND/OR condition tree with real
      // PQL-filter + RBAC resolvers. A legacy flat array is read as implicit AND.
      const tree = parseConditionTree(rule.conditions);
      const ctx  = buildConditionContext(payload as Record<string, unknown>);
      const passed = await evaluateConditionTree(tree, ctx);
      if (!passed) {
        // 6a audit: a non-firing run is recorded as 'skipped' (see 6a recordRun).
        await repo.recordRun?.({ ruleId, payload, status: 'skipped' }).catch(() => {});
        return;
      }

      for (const action of rule.actions) {
        try {
          await executeAction(action, payload);
        } catch (err: any) {
          log.error({ ruleId, action: action.type, err: err?.message }, 'action failed');
        }
      }

      await repo.recordExecution(ruleId);
    },
    { connection, concurrency: 5 },
  );

  worker.on('failed', (job, err) => log.error({ jobId: job?.id, err: err?.message }, 'job failed'));
  worker.on('error',  (err)      => log.error({ err: err?.message }, 'worker error'));

  registerCloser('automation-worker', () => worker.close());
  log.info('worker started');
  return worker;
}
```

> NOTE — `repo.recordRun?.(…)` is written defensively (`?.`) because 6a owns the `AutomationRuns` audit API; use the **exact** 6a method name/shape for writing a `skipped` run (it may already wrap the whole job in a run row, in which case set the run status to `skipped` via 6a's mechanism instead of this extra call). The condition-engine behaviour does not depend on the audit call — keep the evaluator swap regardless.

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: PASS. Then `npm test --workspace apps/api -- condition`. Expected: PASS (unit suites unaffected).

- [ ] Commit:
```
git add apps/api/src/modules/automation/automation.worker.ts
git commit -m "feat(6b): worker evaluates recursive condition tree with real filter/role resolvers"
```

---

### Task 6: OR-group integration test (acceptance §5.5)

**Files:**
- Create: `apps/api/src/modules/automation/__tests__/or-group.integration.test.ts`

Steps:

- [ ] Write the failing integration test first. It uses the 6a harness (the same `testServer`/`truncate`/`factories` the other integration specs import) to create a rule whose conditions are a top-level `OR` group, fire the trigger twice (once matching each branch, once matching neither), and assert the rule fires for either branch and not otherwise — verifying via the 6a `AutomationRuns` audit + the action's effect. (Mirror `recurrence.integration.test.ts` for harness imports; mirror the 6a integration test for how a rule is created and a trigger is fired.)

```ts
/**
 * Phase 6b — condition engine OR-group acceptance (spec §5.5).
 * A rule with a top-level OR group fires for EITHER branch and not otherwise.
 * Exercises the real engine through the 6a worker path + AutomationRuns audit.
 * DB SAFETY: must target local Docker ProjectFlow_Test (see e2e/README).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';
// 6a helpers: enqueue an event synchronously + drain the automation worker in-test.
// Use whatever 6a exposes for deterministic firing (e.g. emitAutomationEvent +
// a runJobInline harness, or processing the BullMQ job immediately). Adapt the
// two helpers below to the 6a integration harness.
import { emitAutomationEvent, drainAutomationJobs } from '../../../__tests__/helpers/automation.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

async function seed() {
  const owner = await createTestUser({ email: `auto-${Date.now()}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const project = await createTestProject(ws.Id, token, { name: 'Auto', key: `AU${Date.now() % 100000}` });
  return { token, userId: owner.id, workspaceId: ws.Id, projectId: project.Id };
}

/** Create a TASK_UPDATED rule: IF (priority is HIGH) OR (status is "Blocked") THEN post a comment. */
async function createOrRule(token: string, projectId: string) {
  const body = {
    projectId,
    name: 'OR-group rule',
    trigger: { type: 'TASK_UPDATED' },
    conditions: {
      op: 'OR',
      children: [
        { type: 'FIELD_EQUALS', field: 'priority', operator: 'is', value: 'HIGH' },
        { type: 'FIELD_EQUALS', field: 'status',   operator: 'is', value: 'Blocked' },
      ],
    },
    actions: [{ type: 'POST_COMMENT', message: 'auto-fired' }],
  };
  return (await json<{ rule: any }>(await request('/automations', { method: 'POST', token, json: body }), 201)).rule;
}

async function fireAndCountRuns(ruleId: string, token: string, projectId: string, workspaceId: string, fields: Record<string, unknown>) {
  await emitAutomationEvent({ type: 'TASK_UPDATED', projectId, workspaceId, payload: { projectId, workspaceId, actorId: null, ...fields } });
  await drainAutomationJobs();
  const runs = (await json<{ runs: any[] }>(await request(`/automations/${ruleId}/runs`, { token }))).runs;
  return runs;
}

describe('condition engine — OR group (spec §5.5)', () => {
  it('fires when the first branch matches (priority HIGH)', async () => {
    const { token, projectId, workspaceId } = await seed();
    const rule = await createOrRule(token, projectId);
    const runs = await fireAndCountRuns(rule.id, token, projectId, workspaceId, { priority: 'HIGH', status: 'In Progress' });
    expect(runs.some((r) => r.status === 'success')).toBe(true);
  });

  it('fires when the second branch matches (status Blocked)', async () => {
    const { token, projectId, workspaceId } = await seed();
    const rule = await createOrRule(token, projectId);
    const runs = await fireAndCountRuns(rule.id, token, projectId, workspaceId, { priority: 'LOW', status: 'Blocked' });
    expect(runs.some((r) => r.status === 'success')).toBe(true);
  });

  it('does NOT fire when neither branch matches', async () => {
    const { token, projectId, workspaceId } = await seed();
    const rule = await createOrRule(token, projectId);
    const runs = await fireAndCountRuns(rule.id, token, projectId, workspaceId, { priority: 'LOW', status: 'In Progress' });
    // The rule was evaluated but skipped — no 'success' run, and a 'skipped' audit row.
    expect(runs.some((r) => r.status === 'success')).toBe(false);
    expect(runs.some((r) => r.status === 'skipped')).toBe(true);
  });
});
```

> NOTE — `emitAutomationEvent`/`drainAutomationJobs` and the exact `/automations` create-body field names (`conditions` accepting a tree, `POST_COMMENT`, `TASK_UPDATED`) come from 6a. Use 6a's real names; if 6a's create route validates `conditions` with a zod schema that only allows the legacy array, extend that schema to accept the tree (a `z.union([z.array(legacyCondition), conditionNodeSchema])`) as part of this task and note it in `DECISIONS.md`. The headline assertion (fires for either branch, not otherwise) is the spec §5.5 acceptance.

- [ ] Run: `npm run test:integration --workspace apps/api -- or-group` against `ProjectFlow_Test` (local DB env only). Expected: FAIL initially if the 6a create-route schema rejects a tree `conditions` value — then PASS once the schema accepts `ConditionNode` (see NOTE).

- [ ] If needed, widen the 6a `conditions` zod schema in `automation.routes.ts` to accept the recursive tree. Add a recursive zod schema near the existing condition schema:

```ts
import { z } from 'zod';

const conditionLeafSchema = z.object({
  type:     z.string(),
  field:    z.string().optional(),
  operator: z.enum(['is', 'is_not', 'contains', 'gt', 'lt', 'before', 'after', 'is_set']).optional(),
  value:    z.string().optional(),
  pql:      z.string().optional(),
});

const conditionNodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({ op: z.enum(['AND', 'OR']), children: z.array(conditionNodeSchema) }),
    conditionLeafSchema,
  ]),
);

// In the rule create/update schema, accept either the legacy flat array OR a tree:
//   conditions: z.union([z.array(legacyConditionSchema), conditionNodeSchema]).default([]),
```

(Adapt to 6a's actual schema variable names; keep the legacy array accepted for backward compatibility.)

- [ ] Run: `npm run test:integration --workspace apps/api -- or-group` against `ProjectFlow_Test`. Expected: PASS (3 tests). Then `npm test --workspace apps/api`. Expected: PASS (full unit suite).

- [ ] Commit:
```
git add apps/api/src/modules/automation/__tests__/or-group.integration.test.ts apps/api/src/modules/automation/automation.routes.ts
git commit -m "test(6b): OR-group rule fires for either branch, not otherwise (spec §5.5) + tree-accepting route schema"
```

---

### Task 7: Upgrade the condition builder UI (nested AND/OR + operator dropdown)

**Files:**
- Modify: `apps/next-web/src/app/(app)/automations/automations-view.tsx`
- Create: `apps/next-web/src/lib/conditionTree.ts`
- Note: read `node_modules/next/dist/docs/` per `apps/next-web/AGENTS.md` before writing web code (this Next.js has breaking changes).

Steps:

- [ ] Create `apps/next-web/src/lib/conditionTree.ts` — a client-side mirror of `parseConditionTree` (legacy-flat → implicit AND) plus an `emptyGroup()` factory, so the dialog can open existing rules and seed new ones without importing API-only code:

```ts
import type { AutomationCondition, ConditionNode, ConditionLeaf, ConditionGroup } from '@projectflow/types';

export function emptyGroup(op: 'AND' | 'OR' = 'AND'): ConditionGroup {
  return { op, children: [] };
}

export function emptyLeaf(): ConditionLeaf {
  return { type: 'FIELD_EQUALS', field: 'priority', operator: 'is', value: 'HIGH' };
}

export function isGroup(node: ConditionNode): node is ConditionGroup {
  return (node as ConditionGroup).op === 'AND' || (node as ConditionGroup).op === 'OR';
}

/** Normalise stored conditions (legacy array OR tree) into a ConditionNode for editing. */
export function parseConditionTreeClient(stored: AutomationCondition[] | ConditionNode | undefined): ConditionNode {
  if (!stored) return emptyGroup('AND');
  if (Array.isArray(stored)) {
    return {
      op: 'AND',
      children: stored.map((c): ConditionLeaf => ({
        type:     c.type,
        field:    c.field,
        operator: c.type === 'FIELD_NOT_EQUALS' ? 'is_not' : c.type === 'IN_SPRINT' || c.type === 'NOT_IN_SPRINT' ? 'is_set' : 'is',
        value:    c.value,
        pql:      c.pql,
      })),
    };
  }
  return stored;
}
```

- [ ] Replace the flat `ConditionList` component with a recursive `ConditionGroupEditor`, and update the dialog state. In `automations-view.tsx`:

  - Add the label maps near `CONDITION_KEYS`:

```ts
const OPERATOR_KEYS: Record<string, string> = {
  is:       'operatorIs',
  is_not:   'operatorIsNot',
  contains: 'operatorContains',
  gt:       'operatorGt',
  lt:       'operatorLt',
  before:   'operatorBefore',
  after:    'operatorAfter',
  is_set:   'operatorIsSet',
};

const GROUP_OP_KEYS: Record<'AND' | 'OR', string> = {
  AND: 'groupAll',
  OR:  'groupAny',
};

const OPERATORS = ['is', 'is_not', 'contains', 'gt', 'lt', 'before', 'after', 'is_set'] as const;
```

  - Change the dialog's `conditions` state from `AutomationCondition[]` to a `ConditionNode`:

```ts
import type { ConditionNode, ConditionLeaf, ConditionOperator } from '@projectflow/types';
import { parseConditionTreeClient, emptyLeaf, emptyGroup, isGroup } from '@/lib/conditionTree';

// inside RuleDialog:
const [conditionTree, setConditionTree] = useState<ConditionNode>(
  parseConditionTreeClient(initial?.conditions as any),
);

// the submit payload sends the tree (server action + REST pass it through opaque):
onSubmit({ name: name.trim(), trigger, conditions: conditionTree as any, actions });
```

  Update the `onSubmit` prop type and the parent `handleSave`/`AutomationsView` so `conditions` is typed `AutomationCondition[] | ConditionNode` (the server actions already forward it unchanged).

  - Replace `<ConditionList conditions={conditions} onChange={setConditions} />` in the dialog body with `<ConditionGroupEditor node={conditionTree} onChange={setConditionTree} root />`.

  - Add the recursive editor component (replacing the old `ConditionList`):

```tsx
function ConditionGroupEditor({
  node, onChange, root = false,
}: {
  node:     ConditionNode;
  onChange: (n: ConditionNode) => void;
  root?:    boolean;
}) {
  const t = useTranslations('Automations');

  // A leaf node rendered standalone (only happens if a stored tree's top node is a leaf).
  if (!isGroup(node)) {
    return <ConditionLeafEditor leaf={node as ConditionLeaf} onChange={onChange} onRemove={() => onChange(emptyGroup('AND'))} />;
  }

  const group = node;
  const setOp       = (op: 'AND' | 'OR') => onChange({ ...group, op });
  const addLeaf     = () => onChange({ ...group, children: [...group.children, emptyLeaf()] });
  const addGroup    = () => onChange({ ...group, children: [...group.children, emptyGroup(group.op === 'AND' ? 'OR' : 'AND')] });
  const updateChild = (i: number, child: ConditionNode) =>
    onChange({ ...group, children: group.children.map((c, idx) => (idx === i ? child : c)) });
  const removeChild = (i: number) =>
    onChange({ ...group, children: group.children.filter((_, idx) => idx !== i) });

  return (
    <div className={cn('flex flex-col gap-2 rounded-md border border-border/60 p-3', root ? 'bg-muted/20' : 'bg-card/60 ml-3')}>
      <div className="flex items-center justify-between gap-2">
        {root && <SectionTitle icon={CircleDot} title={t('ifTitle')} hint={t('ifHint')} />}
        <div className="flex items-center gap-2">
          <Select value={group.op} onValueChange={(v) => setOp(v as 'AND' | 'OR')}>
            <SelectTrigger className="h-7 w-[120px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="AND">{t(GROUP_OP_KEYS.AND as Parameters<typeof t>[0])}</SelectItem>
              <SelectItem value="OR">{t(GROUP_OP_KEYS.OR as Parameters<typeof t>[0])}</SelectItem>
            </SelectContent>
          </Select>
          <Button type="button" size="sm" variant="ghost" onClick={addLeaf}  className="h-7 px-2 text-xs"><Plus className="size-3.5" /> {t('addCondition')}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={addGroup} className="h-7 px-2 text-xs"><Plus className="size-3.5" /> {t('addGroup')}</Button>
        </div>
      </div>

      {group.children.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">{t('noConditions')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {group.children.map((child, i) => (
            isGroup(child)
              ? <div key={i} className="flex items-start gap-1">
                  <ConditionGroupEditor node={child} onChange={(c) => updateChild(i, c)} />
                  <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" onClick={() => removeChild(i)} aria-label={t('removeConditionAriaLabel')}><X className="size-3.5" /></Button>
                </div>
              : <ConditionLeafEditor key={i} leaf={child as ConditionLeaf} onChange={(c) => updateChild(i, c)} onRemove={() => removeChild(i)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConditionLeafEditor({
  leaf, onChange, onRemove,
}: {
  leaf:     ConditionLeaf;
  onChange: (l: ConditionLeaf) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('Automations');
  const update = (patch: Partial<ConditionLeaf>) => onChange({ ...leaf, ...patch });
  const isField  = leaf.type === 'FIELD_EQUALS' || leaf.type === 'FIELD_NOT_EQUALS';
  const isFilter = leaf.type === 'ISSUE_MATCHES_FILTER';
  const isRole   = leaf.type === 'USER_HAS_ROLE';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={leaf.type} onValueChange={(v) => update({ type: v as ConditionLeaf['type'] })}>
        <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {(Object.keys(CONDITION_KEYS) as AutomationConditionType[]).map((k) => (
            <SelectItem key={k} value={k}>{t(CONDITION_KEYS[k] as Parameters<typeof t>[0])}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {isField && (
        <>
          <Input placeholder={t('fieldPlaceholder')} value={leaf.field ?? ''} onChange={(e) => update({ field: e.target.value })} className="h-8 w-[130px] text-xs" />
          <Select value={leaf.operator} onValueChange={(v) => update({ operator: v as ConditionOperator })}>
            <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {OPERATORS.map((op) => <SelectItem key={op} value={op}>{t(OPERATOR_KEYS[op] as Parameters<typeof t>[0])}</SelectItem>)}
            </SelectContent>
          </Select>
          {leaf.operator !== 'is_set' && (
            <Input placeholder={t('valuePlaceholder')} value={leaf.value ?? ''} onChange={(e) => update({ value: e.target.value })} className="h-8 flex-1 min-w-[110px] text-xs" />
          )}
        </>
      )}

      {isFilter && (
        <Input placeholder={t('pqlPlaceholder')} value={leaf.pql ?? ''} onChange={(e) => update({ pql: e.target.value, operator: 'is' })} className="h-8 flex-1 min-w-[160px] text-xs font-mono" />
      )}

      {isRole && (
        <Input placeholder={t('roleSlugPlaceholder')} value={leaf.value ?? ''} onChange={(e) => update({ value: e.target.value, operator: 'is' })} className="h-8 flex-1 min-w-[140px] text-xs font-mono" />
      )}

      <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={onRemove} aria-label={t('removeConditionAriaLabel')}>
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
```

  - Remove the now-unused old `ConditionList` function and its `AutomationCondition[]` usages in the dialog (replace all `conditions`/`setConditions` references in `RuleDialog` with `conditionTree`/`setConditionTree`). Keep the rest of the dialog (trigger/action editors) untouched. The `RuleRow` condition badge that reads `conditions.length` must be made tree-safe — replace its `conditions` array assumption with a count derived from the tree, e.g.:

```tsx
// in RuleRow, replace `const conditions = rule.conditions as AutomationCondition[]` with:
import { parseConditionTreeClient, isGroup } from '@/lib/conditionTree';
function countLeaves(node: any): number {
  if (!node) return 0;
  return isGroup(node) ? node.children.reduce((n: number, c: any) => n + countLeaves(c), 0) : 1;
}
const conditionCount = countLeaves(parseConditionTreeClient(rule.conditions as any));
// …and use `conditionCount > 0` / `t('conditionCount', { count: conditionCount })`.
```

- [ ] Run: `npm run build --workspace apps/next-web` (Next build, includes tsc). Expected: PASS — no type errors; the recursive editor compiles.

- [ ] Commit:
```
git add apps/next-web/src/app/(app)/automations/automations-view.tsx apps/next-web/src/lib/conditionTree.ts
git commit -m "feat(6b): nested AND/OR condition builder with per-leaf operator dropdown"
```

---

### Task 8: i18n keys (en + id) + parity

**Files:**
- Modify: `apps/next-web/messages/en.json`
- Modify: `apps/next-web/messages/id.json`

Steps:

- [ ] Add the new keys to the `Automations` namespace in `en.json` (merge into the existing block — do not drop existing keys):

```json
"groupAll": "Match ALL (AND)",
"groupAny": "Match ANY (OR)",
"addGroup": "Add group",
"operatorIs": "is",
"operatorIsNot": "is not",
"operatorContains": "contains",
"operatorGt": "greater than",
"operatorLt": "less than",
"operatorBefore": "before",
"operatorAfter": "after",
"operatorIsSet": "is set",
"pqlPlaceholder": "PQL filter, e.g. priority = HIGH AND status = \"In Progress\"",
"roleSlugPlaceholder": "Role slug, e.g. workspace-admin"
```

- [ ] Add the same keys to `id.json` with real Indonesian:

```json
"groupAll": "Cocokkan SEMUA (DAN)",
"groupAny": "Cocokkan SALAH SATU (ATAU)",
"addGroup": "Tambah grup",
"operatorIs": "adalah",
"operatorIsNot": "bukan",
"operatorContains": "mengandung",
"operatorGt": "lebih besar dari",
"operatorLt": "lebih kecil dari",
"operatorBefore": "sebelum",
"operatorAfter": "sesudah",
"operatorIsSet": "telah diisi",
"pqlPlaceholder": "Filter PQL, mis. priority = HIGH AND status = \"In Progress\"",
"roleSlugPlaceholder": "Slug peran, mis. workspace-admin"
```

- [ ] Run: `npm test --workspace apps/next-web -- messages` (the `messages.unit` parity test at `apps/next-web/src/i18n/__tests__/messages.unit.test.ts`). Expected: PASS — en/id key parity green.

- [ ] Commit:
```
git add apps/next-web/messages/en.json apps/next-web/messages/id.json
git commit -m "feat(6b): i18n — operator + AND/OR group + PQL/role builder strings (en + id)"
```

---

### Task 9: Optional headline e2e (builder round-trips an OR group)

**Files:**
- Create: `apps/next-web/e2e/automation-conditions.spec.ts`
- Note: e2e runs against local Docker `ProjectFlow_Test` only (use the project's existing e2e env/setup, same as the views/realtime specs).

Steps:

- [ ] Write the e2e spec — open the create dialog, switch the root group to ANY (OR), add two leaf conditions with operators, save, re-open the rule, and assert the OR group + both leaves persist (proving the tree round-trips through REST/GraphQL unchanged). Follow the existing spec harness (login helper + seeded project) used by the other specs:

```ts
import { test, expect } from '@playwright/test';
import { loginAndSeedProject } from './helpers'; // existing helper used by other specs

test.describe('Phase 6b — condition builder', () => {
  test('builds and round-trips an OR group with operators', async ({ page }) => {
    const { automationsUrl } = await loginAndSeedProject(page);
    await page.goto(automationsUrl);

    await page.getByRole('button', { name: /new rule/i }).click();
    await page.getByLabel(/name/i).fill('OR rule e2e');

    // Switch the root condition group to ANY (OR).
    await page.getByRole('combobox', { name: /match/i }).first().click();
    await page.getByRole('option', { name: /match any/i }).click();

    // Add two leaves.
    await page.getByRole('button', { name: /add condition/i }).first().click();
    await page.getByRole('button', { name: /add condition/i }).first().click();

    // Add an action so the rule can be saved.
    await page.getByRole('button', { name: /add action/i }).click();

    await page.getByRole('button', { name: /create rule/i }).click();

    // Re-open and confirm the OR group persisted.
    await page.getByRole('button', { name: /edit/i }).first().click();
    await expect(page.getByText(/match any/i)).toBeVisible();
  });
});
```

- [ ] Run: the project's e2e command for a single spec against `ProjectFlow_Test` (e.g. `npx playwright test e2e/automation-conditions.spec.ts`). Expected: PASS (1 test). If the 6a builder DOM differs from the selectors above, align the selectors to the real labels rather than changing the UI.

- [ ] Commit:
```
git add apps/next-web/e2e/automation-conditions.spec.ts
git commit -m "test(6b): e2e — OR-group condition builder round-trips through save/reopen"
```

---

### Task 10: Slice verification + DECISIONS.md

**Files:**
- Modify: `DECISIONS.md` (append a Phase 6b entry)

Steps:

- [ ] Run the full slice verification on local Docker `ProjectFlow_Test`:
  - `npm test --workspace apps/api` — Expected: PASS (existing suite + new `condition-tree` / `condition-resolvers` unit tests).
  - `npm run test:integration --workspace apps/api` — Expected: PASS (existing + `or-group.integration.test.ts`).
  - `npm test --workspace apps/next-web` — Expected: PASS (unit + `messages.unit` parity).
  - `npm run build --workspace packages/types`, `npm run build --workspace apps/api`, `npm run build --workspace apps/next-web` — Expected: all PASS.
  - The automation-conditions e2e (if authored) — Expected: PASS.

- [ ] Append a `DECISIONS.md` entry logging: the recursive `ConditionNode`/`Operator` model living in `@projectflow/types` alongside the kept legacy `AutomationCondition`; the **no-migration** legacy-flat → implicit-AND adapter (`parseConditionTree`); the pure injected-resolver design (`evaluateConditionTree` stays IO-free, resolvers supplied on `ConditionContext`); `ISSUE_MATCHES_FILTER` reusing `parsePQL` with **in-memory** task matching (no DB round-trip) and its supported-field subset; `USER_HAS_ROLE` reusing `roleService.listUserRoles` and **failing closed** with no actor; the legacy `evaluateConditions` shim decision (deleted vs. kept); the 6a route `conditions` zod schema widened to accept a tree; and the `skipped` `AutomationRuns` audit on non-firing rules. DB-execution-policy note: all DB work ran ONLY against local Docker `ProjectFlow_Test`.

- [ ] Commit:
```
git add DECISIONS.md
git commit -m "docs(6b): DECISIONS entry — recursive condition engine + PQL/RBAC resolvers"
```

---

## Definition of Done

Per-slice DoD (spec §3) + BUILD_PLAN acceptance (spec §5.5):

- [ ] **BUILD_PLAN acceptance (§5.5):** Conditions with AND/OR correctly include/exclude tasks — an OR-group rule fires for **either** branch and **not** when neither matches (proven by `or-group.integration.test.ts`).
- [ ] Recursive `ConditionNode` / `ConditionOperator` model added to `@projectflow/types`; the legacy `AutomationCondition` leaf shape is retained; **no data migration** (legacy flat arrays read as an implicit top-level AND via `parseConditionTree`).
- [ ] Pure `evaluateConditionTree(node, ctx)` replaces the AND-only `evaluateConditions`; every operator (`is`, `is_not`, `contains`, `gt`, `lt`, `before`, `after`, `is_set`) is implemented and unit-tested.
- [ ] `ISSUE_MATCHES_FILTER` reuses the PQL parser (`parsePQL`) and matches in memory; `USER_HAS_ROLE` is a real RBAC check via `roleService.listUserRoles`, failing closed — both stubs removed.
- [ ] The 6a worker evaluates the tree (`await evaluateConditionTree(parseConditionTree(rule.conditions), buildConditionContext(payload))`); non-firing rules record a `skipped` `AutomationRuns` row.
- [ ] The condition builder UI is upgraded to nested AND/OR groups with a per-leaf operator dropdown; existing rules open via the client adapter; the tree round-trips through the unchanged REST/GraphQL `conditions` blob.
- [ ] Unit tests (every operator, nested AND/OR, legacy compatibility, PQL filter, role check) + the OR-group integration test + optional e2e — all green.
- [ ] i18n: new operator / AND-OR group / PQL / role keys in **en.json + id.json** (real Indonesian); `messages.unit` parity green.
- [ ] All DB work (the one integration test) ran **ONLY against local Docker `ProjectFlow_Test`** — never the prod-pointing `apps/api/.env`.
- [ ] `DECISIONS.md` entry logs the model + adapter + resolver choices and any deviation. **Stop for review/merge before Slice 6c.**

---

## Self-Review

**Spec coverage (§5.1–§5.5):**
- §5.1 Model — `ConditionNode = ConditionGroup | ConditionLeaf` with `ConditionGroupOp ('AND'|'OR')` and the exact 8-token `ConditionOperator` union (`is | is_not | contains | gt | lt | before | after | is_set`); backward-compatible parse via `parseConditionTree` (legacy flat → implicit top-level AND, **no migration**). ✅ (Task 1, Task 2)
- §5.2 Evaluator — pure unit-tested `evaluateConditionTree(node, ctx): boolean` replacing AND-only `evaluateConditions`; `ctx` exposes the event payload (task fields, actor, comment via the context builder); `ISSUE_MATCHES_FILTER` reuses `modules/search/pql.parser.ts`; `USER_HAS_ROLE` is a real RBAC check via the roles service. ✅ (Tasks 2–5)
- §5.3 Frontend — condition builder upgraded to nested AND/OR with a per-leaf operator dropdown. ✅ (Task 7)
- §5.4 Tests — unit (each operator; nested AND/OR include/exclude; legacy-flat compatibility; PQL-filter + role evaluation) + integration (OR group fires for either branch, not otherwise). ✅ (Tasks 2, 3, 6)
- §5.5 Acceptance — covered by `or-group.integration.test.ts` (three cases). ✅
- §3 conventions — REST primary + GraphQL mirror untouched (conditions JSON is opaque, flows through transparently — noted); shared types extended; i18n en+id with parity; DB only on `ProjectFlow_Test`; per-task TDD + commits; `DECISIONS.md` entry. ✅

**Placeholder scan:** No "add the other operators similarly" hand-waves — all 8 operators are written out in `compareOperator` with tests; both real resolvers (PQL + RBAC) are full code; the legacy adapter, context builder, worker wiring, recursive editor, and integration test are complete code. The only deliberately deferred-to-6a items are flagged inline as NOTEs (the `AutomationRuns.recordRun` method name, the `emitAutomationEvent`/`drainAutomationJobs` test helpers, and the create-route zod schema variable names) because 6a owns those exact names — the plan tells the implementer to use 6a's real symbols and adapt, and provides the schema-widening code if needed.

**Type/name consistency:** Uses the spec's exact `ConditionNode`/`Operator` shape and operator tokens, the existing `AutomationConditionType` leaf kinds (`ISSUE_MATCHES_FILTER`, `USER_HAS_ROLE`, `FIELD_EQUALS`, `FIELD_NOT_EQUALS`, `IN_SPRINT`, `NOT_IN_SPRINT`), the real reused functions `parsePQL`/`ParsedPQL` and `roleService.listUserRoles`, the real worker call site (`evaluateConditions(rule.conditions, payload)` → tree), and the real frontend symbols (`ConditionList`, `CONDITION_KEYS`, `RuleDialog`, the `Automations` i18n namespace, messages path `apps/next-web/messages/{en,id}.json`, parity test `apps/next-web/src/i18n/__tests__/messages.unit.test.ts`). Test commands match the repo (`vitest run --project unit`/`--project integration` via `npm test` / `npm run test:integration`).

**Ambiguity resolved:** The spec's `ConditionNode` leaf is `{ type, field?, operator, value? }` but legacy `AutomationCondition` also carries `pql`. Resolved by keeping `pql` on the `ConditionLeaf` (used only by `ISSUE_MATCHES_FILTER`) and routing `USER_HAS_ROLE` through `value` (the role slug) — both documented in the type comments and the resolvers. The spec says the evaluator is "pure" but two leaf kinds need IO; resolved by injecting `matchesFilter`/`userHasRole` async resolvers onto `ctx` so the tree-walk core stays pure/sync-testable while the worker awaits at the boundary. PQL matching is done **in memory** against the payload task (not a DB query) so the resolver is fast and deterministic — flagged in `DECISIONS.md`.
