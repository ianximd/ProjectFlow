# Phase 8d — Workload & Box Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `workload` and `box` view types to the Views Engine — a per-assignee capacity view that flags over-capacity assignees, and an assignee-swimlane Box board — backed by one shared capacity-aggregation service that sums assigned time estimates and story points by assignee over a view scope + date range.

**Architecture:** Pure client-side `ViewType` addition (`'workload' | 'box'`) registered in `view-surface.tsx`, plus a single `capacity` aggregation built on the existing Phase 3 Views **query compiler** (`apps/api/src/modules/views/query/compiler.ts`) — it compiles the same scope/filter WHERE clause and sums `Tasks.TimeEstimateSeconds` (8a) and `Tasks.StoryPoints` (8c) per assignee within a `[from,to]` date range. The aggregation surfaces as a GraphQL query (mirroring the GraphQL-only Views Engine) AND a parallel Hono REST route, both delegating to one `viewService.capacity()` method; a separate **pure** capacity classifier module (`over | at | under`) is unit-tested in isolation. **No DB migration** — capacity is computed live from existing 8a/8c columns; the only persisted surface is optional config-only `SavedViews.config` keys (`capacityPerDaySeconds`, `capacityPerSprintPoints`, `capacityMetric`, `groupBy`).

**Tech Stack:** TypeScript; `apps/api` Hono REST + graphql-yoga/Pothos GraphQL over SQL Server SPs (mssql); `apps/next-web` Next.js 16 SSR + next-intl + React 19; Vitest (unit + integration projects on API, single project on web); Playwright e2e.

**Prerequisite:** Phases 1–7 + Slices 8a (task estimates: `Tasks.TimeEstimateSeconds`, `TaskEstimates`) and 8c (story-points rollup: `usp_Sprint_GetPointsRollup`, `Tasks.StoryPoints`) merged.

---

## File Structure

**Create**
- `apps/api/src/modules/views/capacity/capacity-classify.ts` — PURE capacity classifier: maps `(assignedSeconds|assignedPoints, capacity)` → `'over' | 'at' | 'under'` + a ratio. No I/O.
- `apps/api/src/modules/views/capacity/__tests__/capacity-classify.unit.test.ts` — unit tests for the classifier (over/at/under/zero-capacity edges).
- `apps/api/src/modules/views/capacity/capacity-aggregate.ts` — PURE aggregation helper that folds raw per-(assignee) SQL rows into `CapacityRow[]` (merges estimate + points rows, applies classifier). No I/O.
- `apps/api/src/modules/views/capacity/__tests__/capacity-aggregate.unit.test.ts` — unit tests for the fold.
- `apps/api/src/modules/views/capacity.routes.ts` — Hono REST route `GET /views/capacity` (the dual-surface REST mirror), fail-closed authz.
- `apps/api/src/modules/views/__tests__/capacity.integration.test.ts` — integration: capacity sums estimates + points correctly within scope/range against local Docker `ProjectFlow_Test`.
- `apps/next-web/src/components/views/workload-view.tsx` — Workload view component: per-assignee capacity bars + over-capacity flag.
- `apps/next-web/src/components/views/box-view.tsx` — Box view component: assignee swimlanes (reuses Board grouping) + per-assignee card counts.
- `apps/next-web/src/components/views/__tests__/workload-view.test.tsx` — web unit test (testing-library): over-capacity assignee renders the flag.
- `apps/next-web/src/components/views/__tests__/box-view.test.tsx` — web unit test: tasks group into per-assignee swimlanes.
- `apps/next-web/e2e/workload-box-views.spec.ts` — Playwright e2e: open Workload view → over-loaded assignee flagged; Box view groups by assignee.

**Modify**
- `packages/types/index.ts` — add `'workload' | 'box'` to `ViewType`; add `CapacityMetric`, `CapacityStatus`, `CapacityRow`, `CapacityResult`; extend `ViewConfig` with optional capacity config keys.
- `apps/api/src/modules/views/view.service.ts` — add `capacity(userId, scopeType, scopeId, config, range, workspaceId)` reusing `compile()`; new repo call.
- `apps/api/src/modules/views/view.repository.ts` — add `capacityByAssignee(compiled, range)` running the per-assignee SUM query over the compiled WHERE.
- `apps/api/src/graphql/views.schema.ts` — add `viewCapacity` GraphQL query (mirror) + `CapacityRow`/`CapacityResult` object types; widen `VIEW_TYPES`.
- `apps/api/src/server.ts` — mount `capacityRoutes` under `/views` (auth + audit middleware parity).
- `apps/next-web/src/server/queries/views.ts` — add `getViewCapacity(...)` SSR helper (wraps `gqlData`) + `CapacityRow`/`CapacityResult` types.
- `apps/next-web/src/components/views/view-surface.tsx` — dispatch `'workload'`/`'box'` in `ViewBody`; thread capacity data.
- `apps/next-web/src/app/(app)/views/[scopeType]/[scopeId]/page.tsx` — SSR-fetch capacity for `workload`-type active view; pass to `ViewSurface`.
- `apps/next-web/messages/en.json` and `apps/next-web/messages/id.json` — `Views.workload.*` / `Views.box.*` strings (parity).

---

## Tasks

### Task 1: Pure capacity classifier (unit-test-first)

**Files:** `apps/api/src/modules/views/capacity/capacity-classify.ts`, `apps/api/src/modules/views/capacity/__tests__/capacity-classify.unit.test.ts`

- [ ] Write the failing unit test `apps/api/src/modules/views/capacity/__tests__/capacity-classify.unit.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { classifyCapacity } from '../capacity-classify.js';

describe('classifyCapacity', () => {
  it('flags over-capacity when assigned exceeds capacity', () => {
    const r = classifyCapacity(120, 100);
    expect(r.status).toBe('over');
    expect(r.ratio).toBeCloseTo(1.2);
  });

  it('reports under-capacity when assigned is below capacity', () => {
    const r = classifyCapacity(40, 100);
    expect(r.status).toBe('under');
    expect(r.ratio).toBeCloseTo(0.4);
  });

  it('reports at-capacity within the +/-2% tolerance band', () => {
    expect(classifyCapacity(100, 100).status).toBe('at');
    expect(classifyCapacity(101, 100).status).toBe('at'); // within 2%
    expect(classifyCapacity(103, 100).status).toBe('over'); // beyond 2%
  });

  it('treats any positive assignment against zero/absent capacity as over', () => {
    expect(classifyCapacity(10, 0).status).toBe('over');
    expect(classifyCapacity(10, 0).ratio).toBe(Infinity);
  });

  it('treats zero assignment against zero capacity as under with ratio 0', () => {
    const r = classifyCapacity(0, 0);
    expect(r.status).toBe('under');
    expect(r.ratio).toBe(0);
  });

  it('clamps negative inputs to zero', () => {
    expect(classifyCapacity(-5, 100).ratio).toBe(0);
  });
});
```
- [ ] Run `npm --prefix apps/api run test:unit -- capacity-classify` — expect FAIL (`Cannot find module '../capacity-classify.js'`).
- [ ] Create `apps/api/src/modules/views/capacity/capacity-classify.ts`:
```ts
import type { CapacityStatus } from '@projectflow/types';

/** Tolerance band (fraction of capacity) within which assigned load counts as
 *  "at" capacity rather than over/under. 2% absorbs rounding (e.g. 7.5h vs 8h). */
const AT_TOLERANCE = 0.02;

export interface CapacityClassification {
  status: CapacityStatus;   // 'over' | 'at' | 'under'
  ratio: number;            // assigned / capacity (Infinity when capacity == 0 and assigned > 0)
}

/**
 * Pure classifier: compare an assignee's assigned load (seconds OR points — the
 * caller decides the unit) against their capacity in the same unit. No I/O.
 *   - capacity <= 0 & assigned > 0 → 'over' (ratio Infinity)
 *   - capacity <= 0 & assigned == 0 → 'under' (ratio 0)
 *   - |ratio - 1| <= AT_TOLERANCE   → 'at'
 *   - ratio > 1                     → 'over'
 *   - else                          → 'under'
 */
export function classifyCapacity(assigned: number, capacity: number): CapacityClassification {
  const a = Number.isFinite(assigned) && assigned > 0 ? assigned : 0;
  const c = Number.isFinite(capacity) && capacity > 0 ? capacity : 0;
  if (c === 0) {
    return a > 0 ? { status: 'over', ratio: Infinity } : { status: 'under', ratio: 0 };
  }
  const ratio = a / c;
  if (Math.abs(ratio - 1) <= AT_TOLERANCE) return { status: 'at', ratio };
  return { status: ratio > 1 ? 'over' : 'under', ratio };
}
```
- [ ] Add `CapacityStatus` to `packages/types/index.ts` near the Views Engine block (after the `ViewType` line):
```ts
export type CapacityStatus = 'over' | 'at' | 'under';
```
- [ ] Run `npm --prefix apps/api run test:unit -- capacity-classify` — expect PASS (6 tests).
- [ ] Commit: `test(8d): pure capacity classifier (over/at/under) + CapacityStatus type`.

---

### Task 2: Shared capacity types + pure aggregation fold (unit-test-first)

**Files:** `packages/types/index.ts`, `apps/api/src/modules/views/capacity/capacity-aggregate.ts`, `apps/api/src/modules/views/capacity/__tests__/capacity-aggregate.unit.test.ts`

- [ ] Add the capacity result types + `ViewConfig` config keys to `packages/types/index.ts`. Change the `ViewType` line:
```ts
export type ViewType = 'list' | 'board' | 'table' | 'calendar' | 'workload' | 'box';
```
and add after the `ViewTaskPage` interface (~line 1012):
```ts
// ─── Workload / Box capacity (Phase 8d) ────────────────────────────────────
/** Which unit a Workload view measures capacity in. 'time' sums assigned
 *  TimeEstimateSeconds; 'points' sums assigned StoryPoints. */
export type CapacityMetric = 'time' | 'points';

/** One assignee's assigned load vs capacity over the requested range. */
export interface CapacityRow {
  userId: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  assignedSeconds: number;   // sum of TimeEstimateSeconds across assigned in-range tasks
  assignedPoints: number;    // sum of StoryPoints across assigned in-range tasks
  taskCount: number;
  capacity: number;          // capacity in the active metric's unit (seconds or points)
  status: CapacityStatus;    // classifier verdict for the active metric
  ratio: number;             // assigned / capacity in the active metric
}

export interface CapacityResult {
  metric: CapacityMetric;
  from: string | null;       // ISO date (inclusive) or null = unbounded
  to: string | null;         // ISO date (inclusive) or null = unbounded
  rows: CapacityRow[];
}
```
and extend `ViewConfig` (add the optional keys to the existing interface, after `pageSize`):
```ts
  // Phase 8d Workload/Box config-only keys (no schema change — live in SavedViews.config).
  capacityMetric?: CapacityMetric;        // default 'time'
  capacityPerDaySeconds?: number;         // per-assignee daily capacity for metric='time'
  capacityPerSprintPoints?: number;       // per-assignee capacity for metric='points'
```
- [ ] Write the failing unit test `apps/api/src/modules/views/capacity/__tests__/capacity-aggregate.unit.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { aggregateCapacity, type RawCapacityRow } from '../capacity-aggregate.js';

const rows: RawCapacityRow[] = [
  { UserId: 'u1', Name: 'Alice', Email: 'a@x', AvatarUrl: null, AssignedSeconds: 144000, AssignedPoints: 13, TaskCount: 4 },
  { UserId: 'u2', Name: 'Bob',   Email: 'b@x', AvatarUrl: null, AssignedSeconds: 7200,   AssignedPoints: 2,  TaskCount: 1 },
];

describe('aggregateCapacity', () => {
  it('flags an over-capacity assignee in the time metric', () => {
    // capacityPerDaySeconds 28800 (8h) → Alice 144000s = 40h assigned ⇒ over
    const res = aggregateCapacity(rows, { metric: 'time', from: '2026-06-01', to: '2026-06-05', capacityPerDaySeconds: 28800, days: 5 });
    expect(res.metric).toBe('time');
    const alice = res.rows.find((r) => r.userId === 'u1')!;
    expect(alice.capacity).toBe(144000);          // 28800 * 5 days
    expect(alice.assignedSeconds).toBe(144000);
    expect(alice.status).toBe('at');              // 40h assigned vs 40h capacity
    const bob = res.rows.find((r) => r.userId === 'u2')!;
    expect(bob.status).toBe('under');
  });

  it('flags over-capacity in the points metric', () => {
    const res = aggregateCapacity(rows, { metric: 'points', from: null, to: null, capacityPerSprintPoints: 8, days: 0 });
    const alice = res.rows.find((r) => r.userId === 'u1')!;
    expect(alice.capacity).toBe(8);
    expect(alice.assignedPoints).toBe(13);
    expect(alice.status).toBe('over');
  });

  it('returns rows sorted by descending ratio so over-capacity surfaces first', () => {
    const res = aggregateCapacity(rows, { metric: 'points', from: null, to: null, capacityPerSprintPoints: 8, days: 0 });
    expect(res.rows.map((r) => r.userId)).toEqual(['u1', 'u2']);
  });
});
```
- [ ] Run `npm --prefix apps/api run test:unit -- capacity-aggregate` — expect FAIL (module not found).
- [ ] Create `apps/api/src/modules/views/capacity/capacity-aggregate.ts`:
```ts
import { classifyCapacity } from './capacity-classify.js';
import type { CapacityMetric, CapacityResult, CapacityRow } from '@projectflow/types';

/** One SQL row from ViewRepository.capacityByAssignee (PascalCase). */
export interface RawCapacityRow {
  UserId: string;
  Name: string | null;
  Email: string | null;
  AvatarUrl: string | null;
  AssignedSeconds: number | null;
  AssignedPoints: number | null;
  TaskCount: number | null;
}

export interface AggregateOpts {
  metric: CapacityMetric;
  from: string | null;
  to: string | null;
  /** Per-assignee daily capacity in seconds (metric='time'). */
  capacityPerDaySeconds?: number;
  /** Per-assignee capacity in points (metric='points'). */
  capacityPerSprintPoints?: number;
  /** Inclusive day-span of [from,to]; multiplies capacityPerDaySeconds. 0 = use the per-day value as-is. */
  days: number;
}

/**
 * PURE fold: raw per-assignee SQL rows → a classified CapacityResult. Capacity in
 * the active metric's unit = (per-day seconds * days) for 'time', or
 * (per-sprint points) for 'points'. Rows are sorted by descending ratio so the
 * most-overloaded assignee is first (the Workload view renders + flags top-down).
 */
export function aggregateCapacity(raw: RawCapacityRow[], opts: AggregateOpts): CapacityResult {
  const capacity =
    opts.metric === 'time'
      ? (opts.capacityPerDaySeconds ?? 0) * (opts.days > 0 ? opts.days : 1)
      : (opts.capacityPerSprintPoints ?? 0);

  const rows: CapacityRow[] = raw.map((r) => {
    const assignedSeconds = Number(r.AssignedSeconds ?? 0);
    const assignedPoints = Number(r.AssignedPoints ?? 0);
    const assigned = opts.metric === 'time' ? assignedSeconds : assignedPoints;
    const { status, ratio } = classifyCapacity(assigned, capacity);
    return {
      userId: r.UserId,
      name: r.Name ?? null,
      email: r.Email ?? null,
      avatarUrl: r.AvatarUrl ?? null,
      assignedSeconds,
      assignedPoints,
      taskCount: Number(r.TaskCount ?? 0),
      capacity,
      status,
      ratio,
    };
  });

  rows.sort((a, b) => {
    const ra = a.ratio === Infinity ? Number.MAX_VALUE : a.ratio;
    const rb = b.ratio === Infinity ? Number.MAX_VALUE : b.ratio;
    return rb - ra;
  });

  return { metric: opts.metric, from: opts.from, to: opts.to, rows };
}
```
- [ ] Run `npm --prefix apps/api run test:unit -- capacity-aggregate` — expect PASS (3 tests).
- [ ] Run `npm --prefix packages/types run build 2>NUL || npx -y -p typescript tsc --noEmit -p packages/types` (type compile) — expect no errors. (If `packages/types` has no build script, run `npx tsc --noEmit` from its dir.)
- [ ] Commit: `feat(8d): capacity types (CapacityResult/Row, ViewType +workload+box) + pure aggregation fold`.

---

### Task 3: Repository capacity-by-assignee query (reuses the compiled WHERE)

**Files:** `apps/api/src/modules/views/view.repository.ts`

- [ ] Add `capacityByAssignee` to `ViewRepository` (after `groupCounts`). It reuses the compiler's `whereSql` + `params` (same tenant/scope/filter guarantees `queryTasks` relies on) and joins `TaskAssignees` → `Users`, summing `Tasks.TimeEstimateSeconds` (8a) and `Tasks.StoryPoints` (8c). An optional `[from,to]` range bounds on `Tasks.DueDate`:
```ts
  /**
   * Phase 8d — per-assignee capacity aggregation over the SAME compiled WHERE the
   * view's task page uses (tenant + scope + filter), so it can never leak across
   * workspaces/scopes. Sums TimeEstimateSeconds (8a) and StoryPoints (8c) for each
   * assignee on the in-scope, in-range, non-deleted tasks. `range` bounds on DueDate
   * (NULL bound = unbounded on that side). `groupExpr`/`_fid` join params from the
   * compiler are intentionally NOT applied — capacity has no sort joins.
   */
  async capacityByAssignee(
    compiled: CompiledQuery,
    range: { from: string | null; to: string | null },
  ): Promise<Array<{
    UserId: string; Name: string | null; Email: string | null; AvatarUrl: string | null;
    AssignedSeconds: number; AssignedPoints: number; TaskCount: number;
  }>> {
    const pool = await getPool();
    const req = pool.request();
    for (const [k, v] of Object.entries(compiled.params)) req.input(k, v as any);

    const rangeParts: string[] = [];
    if (range.from) { req.input('__capFrom', sql.Date, range.from); rangeParts.push('t.DueDate >= @__capFrom'); }
    if (range.to)   { req.input('__capTo',   sql.Date, range.to);   rangeParts.push('t.DueDate <= @__capTo'); }
    const rangeSql = rangeParts.length ? ` AND ${rangeParts.join(' AND ')}` : '';

    const res = await req.query(
      `SELECT u.Id AS UserId, u.Name, u.Email, u.AvatarUrl,
              SUM(ISNULL(t.TimeEstimateSeconds, 0)) AS AssignedSeconds,
              SUM(ISNULL(t.StoryPoints, 0))         AS AssignedPoints,
              COUNT(t.Id)                           AS TaskCount
         FROM Tasks t
         JOIN TaskAssignees ta ON ta.TaskId = t.Id
         JOIN dbo.Users u ON u.Id = ta.UserId AND u.DeletedAt IS NULL
        WHERE ${compiled.whereSql}${rangeSql}
        GROUP BY u.Id, u.Name, u.Email, u.AvatarUrl
        ORDER BY u.Name`,
    );
    return res.recordset as any[];
  }
```
- [ ] Run `npm --prefix apps/api run build` — expect no TypeScript errors (verifies the new method compiles against `CompiledQuery`/`sql`).
- [ ] Commit: `feat(8d): ViewRepository.capacityByAssignee — per-assignee estimate+points sum over the compiled WHERE`.

---

### Task 4: ViewService.capacity (shared service over the query compiler)

**Files:** `apps/api/src/modules/views/view.service.ts`

- [ ] Add a `capacity` method to `ViewService` (after `runConfig`). It resolves the scope + catalog exactly like `runConfig`, calls `compile(...)`, runs `capacityByAssignee`, then folds with the pure `aggregateCapacity`. The per-day/per-sprint capacity and metric come from the (config-only) `ViewConfig` keys, overridable by explicit args:
```ts
  /**
   * Phase 8d — capacity aggregation for the Workload/Box views. Reuses the Views
   * query compiler so the same scope/filter/tenant guarantees apply, then sums
   * assigned estimates (8a) + points (8c) per assignee over an optional DueDate
   * range and classifies each assignee over/at/under capacity (pure helpers).
   */
  async capacity(
    scopeType: ViewScopeType,
    scopeId: string | null,
    config: ViewConfig,
    range: { from: string | null; to: string | null },
    workspaceId: string | undefined,
    userId: string,
  ): Promise<import('@projectflow/types').CapacityResult> {
    const scope = await this.resolveScope(scopeType, scopeId, workspaceId);
    const catalog = await this.catalogFor(scopeType, scopeId);
    const compiled = compile({
      workspaceId: scope.workspaceId,
      scope: { scopeType, scopePath: scope.scopePath },
      catalog,
      filter: config.filter ?? { conjunction: 'AND', rules: [] },
      sort: [], // capacity does not sort tasks; assignee sort is applied in the fold
      meUserId: config.meMode ? userId : undefined,
    });
    const raw = await this.repo.capacityByAssignee(compiled, range);
    const metric = config.capacityMetric ?? 'time';
    const days = daySpanInclusive(range.from, range.to);
    return aggregateCapacity(raw, {
      metric,
      from: range.from,
      to: range.to,
      capacityPerDaySeconds: config.capacityPerDaySeconds,
      capacityPerSprintPoints: config.capacityPerSprintPoints,
      days,
    });
  }
```
- [ ] Add the imports + the pure day-span helper at the top of `view.service.ts`:
```ts
import { aggregateCapacity } from './capacity/capacity-aggregate.js';
```
and near the other module-level helpers (after `taskListId`):
```ts
/** Inclusive whole-day span between two ISO dates; 0 when either side is open. */
function daySpanInclusive(from: string | null, to: string | null): number {
  if (!from || !to) return 0;
  const ms = Date.parse(to) - Date.parse(from);
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / 86_400_000) + 1;
}
```
- [ ] Run `npm --prefix apps/api run build` — expect no TypeScript errors.
- [ ] Commit: `feat(8d): ViewService.capacity — compiler-backed per-assignee capacity over scope+range`.

---

### Task 5: GraphQL mirror (`viewCapacity`) + REST route (`GET /views/capacity`), both fail-closed

**Files:** `apps/api/src/graphql/views.schema.ts`, `apps/api/src/modules/views/capacity.routes.ts`, `apps/api/src/server.ts`

- [ ] In `apps/api/src/graphql/views.schema.ts`, widen the local view-type allow-list so `workload`/`box` saved views can be created:
```ts
type ViewType = 'list' | 'board' | 'table' | 'calendar' | 'workload' | 'box';
const VIEW_TYPES: readonly ViewType[] = ['list', 'board', 'table', 'calendar', 'workload', 'box'];
```
- [ ] Add the import of `CapacityResult`/`CapacityRow` to the type-only import line at the top:
```ts
import type { SavedView, ViewTaskPage, ViewConfig, HierarchyNodeType, CapacityResult, CapacityRow } from '@projectflow/types';
```
- [ ] Inside `registerViewsGraphql()`, after `ViewTaskPageType` is implemented, add the capacity object types:
```ts
  const CapacityRowType = builder.objectRef<CapacityRow>('ViewCapacityRow');
  CapacityRowType.implement({ fields: (t) => ({
    userId:          t.exposeString('userId'),
    name:            t.string({ nullable: true, resolve: (r) => r.name }),
    email:           t.string({ nullable: true, resolve: (r) => r.email }),
    avatarUrl:       t.string({ nullable: true, resolve: (r) => r.avatarUrl }),
    assignedSeconds: t.exposeFloat('assignedSeconds'),
    assignedPoints:  t.exposeFloat('assignedPoints'),
    taskCount:       t.exposeInt('taskCount'),
    capacity:        t.exposeFloat('capacity'),
    status:          t.exposeString('status'),
    // ratio can be Infinity (zero-capacity) — expose as a clamped float so it stays JSON-safe.
    ratio:           t.float({ resolve: (r) => (Number.isFinite(r.ratio) ? r.ratio : 1e9) }),
  }) });

  const CapacityResultType = builder.objectRef<CapacityResult>('ViewCapacityResult');
  CapacityResultType.implement({ fields: (t) => ({
    metric: t.exposeString('metric'),
    from:   t.string({ nullable: true, resolve: (r) => r.from }),
    to:     t.string({ nullable: true, resolve: (r) => r.to }),
    rows:   t.field({ type: [CapacityRowType], resolve: (r) => r.rows }),
  }) });
```
- [ ] Add the `viewCapacity` query inside the `builder.queryFields((t) => ({ ... }))` block (alongside `previewViewTasks`). It enforces the SAME fail-closed authz as `previewViewTasks` (`requireObjectLevel(...,'VIEW')` for node scopes; `requireEverythingWorkspace` for EVERYTHING):
```ts
    viewCapacity: t.field({
      type: CapacityResultType,
      args: {
        scopeType: t.arg.string({ required: true }), scopeId: t.arg.string({ required: false }),
        config: t.arg.string({ required: true }),
        from: t.arg.string({ required: false }), to: t.arg.string({ required: false }),
        workspaceId: t.arg.string({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        const userId = requireUser(ctx);
        const scopeType = assertScopeType(a.scopeType);
        const node = authzNode(scopeType);
        if (node) await requireObjectLevel(ctx, node, a.scopeId, 'VIEW');
        else await requireEverythingWorkspace(ctx, a.workspaceId);
        let config: ViewConfig;
        try { config = JSON.parse(a.config) as ViewConfig; }
        catch { throw new GraphQLError('Invalid config JSON', { extensions: { code: 'VIEW_VALIDATION' } }); }
        try {
          return await viewService.capacity(
            scopeType, a.scopeId ?? null, config,
            { from: a.from ?? null, to: a.to ?? null },
            a.workspaceId ?? undefined, userId,
          );
        } catch (e) { throw toGraphqlError(e); }
      },
    }),
```
- [ ] Create the REST mirror `apps/api/src/modules/views/capacity.routes.ts`. REST is the spec's primary surface; it delegates to the SAME `viewService.capacity`. Authz is fail-closed: node scopes require object-level VIEW via the access service; EVERYTHING requires `workspace.read`. (Mirrors the GraphQL gate using the same `accessService`/`roleService` the GraphQL authz helpers call.)
```ts
import { Hono } from 'hono';
import { viewService } from './view.service.js';
import { accessService } from '../access/access.service.js';
import { roleService } from '../roles/role.service.js';
import type { ViewConfig, ViewScopeType } from '@projectflow/types';

export const capacityRoutes = new Hono();

const SCOPES: readonly ViewScopeType[] = ['LIST', 'FOLDER', 'SPACE', 'EVERYTHING'];

// GET /views/capacity?scopeType=&scopeId=&config=<json>&from=&to=&workspaceId=
// REST mirror of the GraphQL `viewCapacity` query. Fail-closed authz BEFORE any
// aggregation: node scopes require object-level VIEW; EVERYTHING requires the
// workspace.read slug. Returns 400 on a bad scope/config, 403 on no access.
capacityRoutes.get('/capacity', async (c) => {
  const user = (c as any).get('user') as { userId: string } | undefined;
  if (!user) return c.json({ error: { message: 'Unauthorized' } }, 401);

  const scopeType = c.req.query('scopeType') as ViewScopeType | undefined;
  if (!scopeType || !SCOPES.includes(scopeType))
    return c.json({ error: { message: 'Invalid scopeType' } }, 400);
  const scopeId = c.req.query('scopeId') ?? null;
  const workspaceId = c.req.query('workspaceId') ?? undefined;

  let config: ViewConfig;
  try { config = JSON.parse(c.req.query('config') ?? '') as ViewConfig; }
  catch { return c.json({ error: { message: 'Invalid config JSON' } }, 400); }

  // Fail-closed authorization.
  if (scopeType === 'EVERYTHING') {
    if (!workspaceId) return c.json({ error: { message: 'workspaceId required' } }, 400);
    const perms = await roleService.getUserPermissionSlugs(user.userId, workspaceId);
    if (!perms.has('workspace.read')) return c.json({ error: { message: 'Forbidden' } }, 403);
  } else {
    if (!scopeId) return c.json({ error: { message: 'scopeId required' } }, 400);
    const { level, found } = await accessService.resolveOrNull(user.userId, scopeType as any, scopeId);
    if (!found) return c.json({ error: { message: 'Not found' } }, 404);
    if (!level) return c.json({ error: { message: 'Forbidden' } }, 403);
  }

  const result = await viewService.capacity(
    scopeType, scopeId, config,
    { from: c.req.query('from') ?? null, to: c.req.query('to') ?? null },
    workspaceId, user.userId,
  );
  return c.json({ data: result });
});
```
- [ ] Mount the route in `apps/api/src/server.ts`. Add the import near the other route imports:
```ts
import { capacityRoutes } from './modules/views/capacity.routes.js';
```
and (following the `/sprints` middleware/route pattern) add auth + audit + the mount — put these next to the existing route registrations:
```ts
app.use('/views/*', authMiddleware);
app.use('/views/*', auditMiddleware);
app.route('/views', capacityRoutes);
```
- [ ] Run `npm --prefix apps/api run build` — expect no TypeScript errors.
- [ ] Commit: `feat(8d): viewCapacity GraphQL query + GET /views/capacity REST mirror (fail-closed authz)`.

---

### Task 6: Capacity integration test (local Docker `ProjectFlow_Test`)

**Files:** `apps/api/src/modules/views/__tests__/capacity.integration.test.ts`

- [ ] Write the integration test, copying the seed/setup conventions from a sibling views integration test (`apps/api/src/modules/views/__tests__/query-tasks.integration.test.ts`) — reuse its workspace/space/list/task seed helpers and DB env wiring. The test seeds a SPACE scope with two assignees, gives one assignee tasks whose `TimeEstimateSeconds` exceed an 8h/day capacity, and asserts the capacity result flags that assignee `over`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { viewService } from '../view.service.js';
// Reuse the existing integration seed helpers used by query-tasks.integration.test.ts.
import {
  seedWorkspaceSpaceList, seedTask, assignTask, setTimeEstimate, setStoryPoints, cleanup, type Seed,
} from './_helpers.js'; // NOTE: if query-tasks.integration.test.ts inlines its seed, inline the same here instead.

let seed: Seed;
const FILTER = { conjunction: 'AND' as const, rules: [] };

beforeAll(async () => {
  seed = await seedWorkspaceSpaceList();
  // Alice: 5 tasks @ 8h estimate each (40h) → over an 8h/day * 5d = 40h capacity? exactly at; push 1 more to go over.
  const alice = seed.userA, bob = seed.userB;
  for (let i = 0; i < 6; i++) {
    const tId = await seedTask(seed, { dueDate: '2026-06-03' });
    await assignTask(tId, alice);
    await setTimeEstimate(tId, 28800);   // 8h
    await setStoryPoints(tId, 3);
  }
  const bTask = await seedTask(seed, { dueDate: '2026-06-03' });
  await assignTask(bTask, bob);
  await setTimeEstimate(bTask, 3600);    // 1h
  await setStoryPoints(bTask, 1);
});

afterAll(async () => { await cleanup(seed); });

describe('viewService.capacity (integration)', () => {
  it('sums assigned estimates per assignee and flags over-capacity (time metric)', async () => {
    const res = await viewService.capacity(
      'SPACE', seed.spaceId,
      { filter: FILTER, sort: [], capacityMetric: 'time', capacityPerDaySeconds: 28800 } as any,
      { from: '2026-06-01', to: '2026-06-05' }, // 5-day span → 40h capacity
      undefined, seed.userA,
    );
    expect(res.metric).toBe('time');
    const alice = res.rows.find((r) => r.userId === seed.userA)!;
    expect(alice.assignedSeconds).toBe(6 * 28800); // 48h
    expect(alice.status).toBe('over');             // 48h > 40h
    const bob = res.rows.find((r) => r.userId === seed.userB)!;
    expect(bob.status).toBe('under');
    // Over-capacity assignee sorts first.
    expect(res.rows[0]!.userId).toBe(seed.userA);
  });

  it('sums points and respects the points metric capacity', async () => {
    const res = await viewService.capacity(
      'SPACE', seed.spaceId,
      { filter: FILTER, sort: [], capacityMetric: 'points', capacityPerSprintPoints: 8 } as any,
      { from: null, to: null }, undefined, seed.userA,
    );
    const alice = res.rows.find((r) => r.userId === seed.userA)!;
    expect(alice.assignedPoints).toBe(6 * 3); // 18 points
    expect(alice.status).toBe('over');        // 18 > 8
  });

  it('range filter excludes out-of-range tasks from the sum', async () => {
    const res = await viewService.capacity(
      'SPACE', seed.spaceId,
      { filter: FILTER, sort: [], capacityMetric: 'time', capacityPerDaySeconds: 28800 } as any,
      { from: '2026-07-01', to: '2026-07-31' }, undefined, seed.userA,
    );
    expect(res.rows.find((r) => r.userId === seed.userA)).toBeUndefined();
  });
});
```
> If `query-tasks.integration.test.ts` inlines its seed rather than exporting `_helpers.js`, replicate that inline seed here (same SP calls: `usp_Task_Create`, `usp_Task_AssignUser`/`TaskAssignees` insert, `usp_Task_SetEstimate` from 8a, story-points via `usp_Task_Update`) — do NOT invent a helpers module that doesn't exist.
- [ ] Run `npm --prefix apps/api run test:integration -- capacity` against local Docker `ProjectFlow_Test` (set the local DB env exactly as the other integration tests do; NEVER use the prod-pointing `apps/api/.env`). Expect FAIL first if 8a's `TimeEstimateSeconds`/`usp_Task_SetEstimate` are not deployed → deploy SPs/migrations for the test DB, then expect PASS (3 tests).
- [ ] Commit: `test(8d): capacity aggregation integration — per-assignee estimate+points sum, range filter, over-flag`.

---

### Task 7: SSR capacity query helper + `ViewType` plumbing in views.ts

**Files:** `apps/next-web/src/server/queries/views.ts`

- [ ] Add the `CapacityRow`/`CapacityResult` import and a `getViewCapacity` SSR helper to `apps/next-web/src/server/queries/views.ts` (mirrors `previewViewTasks` — wraps `gqlData`, `cache()`-wrapped). Add the import:
```ts
import type { SavedView, ViewConfig, ViewGroup, CapacityResult } from '@projectflow/types';
```
and at the end of the file:
```ts
const VIEW_CAPACITY_QUERY = /* GraphQL */ `
  query ViewCapacity(
    $scopeType: String!, $scopeId: String, $config: String!,
    $from: String, $to: String, $workspaceId: String
  ) {
    viewCapacity(
      scopeType: $scopeType, scopeId: $scopeId, config: $config,
      from: $from, to: $to, workspaceId: $workspaceId
    ) {
      metric
      from
      to
      rows {
        userId name email avatarUrl
        assignedSeconds assignedPoints taskCount
        capacity status ratio
      }
    }
  }
`;

/** Per-assignee capacity for a Workload/Box view (over/at/under, sums of assigned
 *  estimates + points within an optional date range). `config` is serialized to
 *  the JSON-string arg the schema expects. */
export const getViewCapacity = cache(async (
  scopeType: SavedView['scopeType'],
  scopeId: string | null,
  config: ViewConfig,
  range: { from: string | null; to: string | null },
  workspaceId?: string,
): Promise<CapacityResult> => {
  const { viewCapacity } = await gqlData<{ viewCapacity: CapacityResult | null }>(VIEW_CAPACITY_QUERY, {
    scopeType,
    scopeId: scopeId ?? null,
    config: JSON.stringify(config),
    from: range.from,
    to: range.to,
    workspaceId: workspaceId ?? null,
  });
  return viewCapacity ?? { metric: config.capacityMetric ?? 'time', from: range.from, to: range.to, rows: [] };
});
```
- [ ] Run `npx --prefix apps/next-web tsc --noEmit -p apps/next-web` (or `npm --prefix apps/next-web run lint` if tsc is wired through it) — expect no errors. (Reading `node_modules/next/dist/docs/` is required before web changes per `apps/next-web/AGENTS.md`; `server-only` + `cache()` usage here matches the existing helpers.)
- [ ] Commit: `feat(8d): getViewCapacity SSR query helper (GraphQL viewCapacity)`.

---

### Task 8: Workload view component (capacity bars + over-capacity flag) — unit-test-first

**Files:** `apps/next-web/src/components/views/workload-view.tsx`, `apps/next-web/src/components/views/__tests__/workload-view.test.tsx`

- [ ] Write the failing web unit test `apps/next-web/src/components/views/__tests__/workload-view.test.tsx` (testing-library + Vitest harness, mirroring `apps/next-web/src/components/admin/__tests__/PermissionPicker.test.tsx`; wrap in `NextIntlClientProvider` with the `Views` messages):
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../../../messages/en.json';
import { WorkloadView } from '../workload-view';
import type { CapacityResult } from '@projectflow/types';

function renderView(capacity: CapacityResult) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <WorkloadView capacity={capacity} />
    </NextIntlClientProvider>,
  );
}

const base: CapacityResult = {
  metric: 'time', from: '2026-06-01', to: '2026-06-05',
  rows: [
    { userId: 'u1', name: 'Alice', email: null, avatarUrl: null, assignedSeconds: 172800, assignedPoints: 0, taskCount: 6, capacity: 144000, status: 'over', ratio: 1.2 },
    { userId: 'u2', name: 'Bob',   email: null, avatarUrl: null, assignedSeconds: 36000,  assignedPoints: 0, taskCount: 1, capacity: 144000, status: 'under', ratio: 0.25 },
  ],
};

describe('WorkloadView', () => {
  it('renders a row per assignee', () => {
    renderView(base);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('flags the over-capacity assignee', () => {
    renderView(base);
    const aliceRow = screen.getByTestId('workload-row-u1');
    expect(aliceRow).toHaveAttribute('data-status', 'over');
    expect(aliceRow.querySelector('[data-testid="over-capacity-badge"]')).not.toBeNull();
  });

  it('does not flag an under-capacity assignee', () => {
    renderView(base);
    const bobRow = screen.getByTestId('workload-row-u2');
    expect(bobRow).toHaveAttribute('data-status', 'under');
    expect(bobRow.querySelector('[data-testid="over-capacity-badge"]')).toBeNull();
  });

  it('renders an empty state when no assignees', () => {
    renderView({ ...base, rows: [] });
    expect(screen.getByTestId('workload-empty')).toBeInTheDocument();
  });
});
```
- [ ] Run `npm --prefix apps/next-web run test:unit -- workload-view` — expect FAIL (module not found).
- [ ] Create `apps/next-web/src/components/views/workload-view.tsx`:
```tsx
'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { CapacityResult } from '@projectflow/types';

interface Props {
  /** Per-assignee capacity resolved SSR via getViewCapacity. */
  capacity: CapacityResult | null;
}

/** Format a duration in seconds as a compact "Xh"/"Xh Ym" string. */
function fmtHours(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const BAR_TONE: Record<string, string> = {
  over:  'bg-red-500',
  at:    'bg-amber-500',
  under: 'bg-emerald-500',
};

export function WorkloadView({ capacity }: Props) {
  const t = useTranslations('Views');
  const rows = capacity?.rows ?? [];
  const isPoints = capacity?.metric === 'points';

  if (rows.length === 0) {
    return (
      <div
        data-testid="workload-empty"
        className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground"
      >
        {t('workload.empty')}
      </div>
    );
  }

  return (
    <div data-testid="view-body-workload" className="flex h-full flex-col gap-2 overflow-auto rounded-lg border border-border bg-background p-3">
      {rows.map((r) => {
        const assigned = isPoints ? r.assignedPoints : r.assignedSeconds;
        const capValue = r.capacity;
        const pct = Math.min(100, Math.round((Number.isFinite(r.ratio) ? r.ratio : 1) * 100));
        const assignedLabel = isPoints ? t('workload.points', { value: assigned }) : fmtHours(assigned);
        const capLabel = isPoints ? t('workload.points', { value: capValue }) : fmtHours(capValue);
        return (
          <div
            key={r.userId}
            data-testid={`workload-row-${r.userId}`}
            data-status={r.status}
            className={cn('rounded-md border border-border/60 p-2', r.status === 'over' && 'border-red-400/60 bg-red-500/5')}
          >
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-foreground">{r.name ?? r.email ?? r.userId}</span>
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className="font-mono">{assignedLabel} / {capLabel}</span>
                {r.status === 'over' && (
                  <Badge
                    data-testid="over-capacity-badge"
                    variant="outline"
                    size="xs"
                    appearance="outline"
                    className="border-red-400/60 text-red-600"
                  >
                    <AlertTriangle className="size-3" aria-hidden="true" /> {t('workload.overCapacity')}
                  </Badge>
                )}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('workload.barAria', { name: r.name ?? r.userId })}>
              <div className={cn('h-full', BAR_TONE[r.status] ?? BAR_TONE.under)} style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">{t('workload.taskCount', { count: r.taskCount })}</div>
          </div>
        );
      })}
    </div>
  );
}
```
- [ ] Add the `Views.workload.*` keys to `apps/next-web/messages/en.json` (so the test's `NextIntlClientProvider` resolves them) under the existing `Views` namespace:
```json
"workload": {
  "empty": "No assignees with work in this range.",
  "overCapacity": "Over capacity",
  "points": "{value} pts",
  "taskCount": "{count, plural, one {# task} other {# tasks}}",
  "barAria": "Capacity for {name}"
}
```
- [ ] Run `npm --prefix apps/next-web run test:unit -- workload-view` — expect PASS (4 tests).
- [ ] Commit: `feat(8d): WorkloadView component — per-assignee capacity bars + over-capacity flag`.

---

### Task 9: Box view component (assignee swimlanes, reusing Board grouping) — unit-test-first

**Files:** `apps/next-web/src/components/views/box-view.tsx`, `apps/next-web/src/components/views/__tests__/box-view.test.tsx`

- [ ] Write the failing web unit test `apps/next-web/src/components/views/__tests__/box-view.test.tsx`. It renders `BoxView` with a `ViewTaskPageResult` whose tasks carry assignees and asserts a swimlane per assignee + the per-assignee card count:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../../../messages/en.json';
import { BoxView } from '../box-view';
import type { SavedView } from '@projectflow/types';
import type { ViewTaskPageResult } from '@/server/queries/views';

const view = { id: 'v1', type: 'box', config: { filter: { conjunction: 'AND', rules: [] }, sort: [] } } as unknown as SavedView;

const taskPage: ViewTaskPageResult = {
  total: 3,
  groups: [],
  tasks: [
    { id: 't1', title: 'A', status: 'To Do', priority: 'MEDIUM', assignees: [{ userId: 'u1', name: 'Alice', email: 'a@x', avatarUrl: null }] },
    { id: 't2', title: 'B', status: 'To Do', priority: 'LOW',    assignees: [{ userId: 'u1', name: 'Alice', email: 'a@x', avatarUrl: null }] },
    { id: 't3', title: 'C', status: 'Done',  priority: 'HIGH',   assignees: [{ userId: 'u2', name: 'Bob',   email: 'b@x', avatarUrl: null }] },
  ] as any,
};

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <BoxView taskPage={taskPage} activeView={view} />
    </NextIntlClientProvider>,
  );
}

describe('BoxView', () => {
  it('renders one swimlane per assignee', () => {
    renderView();
    expect(screen.getByTestId('box-lane-u1')).toBeInTheDocument();
    expect(screen.getByTestId('box-lane-u2')).toBeInTheDocument();
  });

  it('shows the per-assignee card count', () => {
    renderView();
    expect(screen.getByTestId('box-lane-u1')).toHaveAttribute('data-count', '2');
    expect(screen.getByTestId('box-lane-u2')).toHaveAttribute('data-count', '1');
  });

  it('renders an Unassigned lane when a task has no assignee', () => {
    const tp = { ...taskPage, tasks: [...taskPage.tasks, { id: 't4', title: 'D', status: 'To Do', priority: 'LOW', assignees: [] }] as any };
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <BoxView taskPage={tp} activeView={view} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId('box-lane-__unassigned__')).toHaveAttribute('data-count', '1');
  });
});
```
- [ ] Run `npm --prefix apps/next-web run test:unit -- box-view` — expect FAIL (module not found).
- [ ] Create `apps/next-web/src/components/views/box-view.tsx`. It reuses the same assignee-grouping idea as `board-view-engine.tsx` (group tasks by assignee → lanes), rendering each lane with a card count. (Keeping it a self-contained lane renderer avoids entangling the Board's column/DnD machinery; the grouping logic — bucket tasks by `assignees` — mirrors the engine.)
```tsx
'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Task } from '@/server/queries/normalize-task';
import type { ViewTaskPageResult } from '@/server/queries/views';
import type { SavedView } from '@projectflow/types';

interface Props {
  taskPage: ViewTaskPageResult | null;
  activeView: SavedView;
}

const UNASSIGNED = '__unassigned__';

interface Lane { key: string; label: string; tasks: Task[] }

export function BoxView({ taskPage }: Props) {
  const t = useTranslations('Views');
  const tasks = useMemo(() => taskPage?.tasks ?? [], [taskPage]);

  // Group tasks into per-assignee swimlanes (a task with N assignees appears in N
  // lanes — same multi-assignee semantics the engine board uses). Tasks with no
  // assignee fall into a single "Unassigned" lane.
  const lanes: Lane[] = useMemo(() => {
    const byUser = new Map<string, Lane>();
    const ensure = (key: string, label: string) => {
      let lane = byUser.get(key);
      if (!lane) { lane = { key, label, tasks: [] }; byUser.set(key, lane); }
      return lane;
    };
    for (const task of tasks) {
      if (task.assignees.length === 0) {
        ensure(UNASSIGNED, t('box.unassigned')).tasks.push(task);
        continue;
      }
      for (const a of task.assignees) {
        ensure(a.userId, a.name ?? a.email ?? a.userId).tasks.push(task);
      }
    }
    // Stable order: named assignees A→Z, Unassigned last.
    return [...byUser.values()].sort((x, y) => {
      if (x.key === UNASSIGNED) return 1;
      if (y.key === UNASSIGNED) return -1;
      return x.label.localeCompare(y.label);
    });
  }, [tasks, t]);

  if (tasks.length === 0) {
    return (
      <div data-testid="box-empty" className="flex h-full items-center justify-center rounded-lg border border-dashed border-border p-8 text-xs text-muted-foreground">
        {t('noTasks')}
      </div>
    );
  }

  return (
    <div data-testid="view-body-box" className="flex h-full gap-3 overflow-auto rounded-lg border border-border bg-background p-3">
      {lanes.map((lane) => (
        <div
          key={lane.key}
          data-testid={`box-lane-${lane.key}`}
          data-count={lane.tasks.length}
          className="flex w-72 shrink-0 flex-col gap-2 rounded-md bg-muted/30 p-2"
        >
          <div className="flex items-center justify-between px-1 text-xs font-semibold text-foreground">
            <span className="truncate">{lane.label}</span>
            <Badge variant="outline" size="xs" appearance="outline">{lane.tasks.length}</Badge>
          </div>
          <div className="flex flex-col gap-1.5">
            {lane.tasks.map((task) => (
              <div
                key={`${lane.key}:${task.id}`}
                data-testid="box-card"
                className={cn('rounded-md border border-border/60 bg-background p-2 text-xs')}
              >
                <div className="truncate font-medium text-foreground">{task.title || t('untitled')}</div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Badge variant="outline" size="xs" appearance="outline">{task.status}</Badge>
                  {task.issueKey && <span className="font-mono">{task.issueKey}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```
- [ ] Add the `Views.box.*` keys to `apps/next-web/messages/en.json` under the `Views` namespace:
```json
"box": {
  "unassigned": "Unassigned"
}
```
- [ ] Run `npm --prefix apps/next-web run test:unit -- box-view` — expect PASS (3 tests).
- [ ] Commit: `feat(8d): BoxView component — assignee swimlanes + per-assignee card counts`.

---

### Task 10: Dispatch in view-surface + SSR capacity wiring + i18n parity (en + id)

**Files:** `apps/next-web/src/components/views/view-surface.tsx`, `apps/next-web/src/app/(app)/views/[scopeType]/[scopeId]/page.tsx`, `apps/next-web/messages/en.json`, `apps/next-web/messages/id.json`

- [ ] In `apps/next-web/src/components/views/view-surface.tsx`, import the two new components + the capacity type, add a `capacity` prop to `Props` and to `ViewBody`, and add the `'workload'`/`'box'` cases. Add imports:
```ts
import { WorkloadView } from '@/components/views/workload-view';
import { BoxView } from '@/components/views/box-view';
import type { CapacityResult } from '@projectflow/types';
```
Add to the `Props` interface (after `live`):
```ts
  /** Per-assignee capacity, resolved SSR for a Workload active view. Null otherwise. */
  capacity?: CapacityResult | null;
```
Thread it through `ViewSurface(...)` destructure + the `<ViewBody ... />` call (add `capacity={capacity}`), add `capacity` to the `ViewBody` param list + its type signature (`capacity?: CapacityResult | null;`), and add the cases inside the `switch (type)`:
```ts
    case 'workload':
      return <WorkloadView capacity={capacity ?? null} />;
    case 'box':
      return <BoxView taskPage={taskPage} activeView={activeView} />;
```
- [ ] In `apps/next-web/src/app/(app)/views/[scopeType]/[scopeId]/page.tsx`, import `getViewCapacity` and resolve capacity SSR when the active view is a Workload view. Add to the import from `@/server/queries/views`:
```ts
import { getSavedViews, getViewTasks, getViewWorkflowStatuses, getViewCapacity, type ViewTaskPageResult } from '@/server/queries/views';
```
Add after `boardWorkflowStatuses` is computed:
```ts
  // Workload view: resolve per-assignee capacity SSR from the active view's config
  // (config-only capacity keys) over an optional [from,to] DueDate range (from
  // searchParams, else unbounded). Box view groups client-side from taskPage, so
  // it needs no extra SSR fetch.
  const capacity =
    activeView?.type === 'workload'
      ? await getViewCapacity(
          scopeType,
          nodeScopeId,
          activeView.config,
          { from: sp.from ?? null, to: sp.to ?? null },
          workspaceId,
        )
      : null;
```
Add `from?` / `to?` to the `searchParams` type:
```ts
  searchParams: Promise<{ viewId?: string; page?: string; meMode?: string; view?: string; from?: string; to?: string }>;
```
Pass it to the surface: add `capacity={capacity}` to the `<ViewSurface ... />` props.
- [ ] Mirror ALL new `Views.workload.*` + `Views.box.*` keys into `apps/next-web/messages/id.json` with real Indonesian translations under the `Views` namespace:
```json
"workload": {
  "empty": "Tidak ada penerima tugas dengan pekerjaan dalam rentang ini.",
  "overCapacity": "Melebihi kapasitas",
  "points": "{value} poin",
  "taskCount": "{count, plural, other {# tugas}}",
  "barAria": "Kapasitas untuk {name}"
},
"box": {
  "unassigned": "Belum ditugaskan"
}
```
- [ ] Run `npm --prefix apps/next-web run test:unit -- messages.unit` (the i18n parity test) — expect PASS (en/id key sets match).
- [ ] Run `npm --prefix apps/next-web run build` — expect a clean Next build (workload/box dispatch compiles; reading `node_modules/next/dist/docs/` first per `apps/next-web/AGENTS.md`).
- [ ] Commit: `feat(8d): dispatch workload/box in view-surface + SSR capacity wiring + en/id i18n parity`.

---

### Task 11: Playwright e2e — Workload flags over-capacity; Box groups by assignee

**Files:** `apps/next-web/e2e/workload-box-views.spec.ts`

- [ ] Author the e2e spec `apps/next-web/e2e/workload-box-views.spec.ts`, following the repo's established Playwright conventions (grant-superadmin DB-name env fix + local Docker `ProjectFlow_Test` seeding as the views e2e already does). It seeds a SPACE with an over-loaded assignee, creates a `workload`-type saved view (config `capacityMetric:'time'`, `capacityPerDaySeconds:28800`) and a `box`-type view, then asserts the over-capacity flag + the assignee lanes:
```ts
import { test, expect } from '@playwright/test';
import { seedWorkloadScenario, loginAs } from './helpers/views-e2e-setup'; // reuse the existing views e2e setup module; do NOT invent a new harness.

test.describe('Phase 8d — Workload & Box views', () => {
  test('Workload view flags an over-capacity assignee', async ({ page }) => {
    const { spaceId, workloadViewId, overUserId } = await seedWorkloadScenario();
    await loginAs(page);
    await page.goto(`/views/SPACE/${spaceId}?viewId=${workloadViewId}&from=2026-06-01&to=2026-06-05`);

    await expect(page.getByTestId('view-body-workload')).toBeVisible();
    const overRow = page.getByTestId(`workload-row-${overUserId}`);
    await expect(overRow).toHaveAttribute('data-status', 'over');
    await expect(overRow.getByTestId('over-capacity-badge')).toBeVisible();
  });

  test('Box view groups tasks into per-assignee swimlanes', async ({ page }) => {
    const { spaceId, boxViewId, overUserId } = await seedWorkloadScenario();
    await loginAs(page);
    await page.goto(`/views/SPACE/${spaceId}?viewId=${boxViewId}`);

    await expect(page.getByTestId('view-body-box')).toBeVisible();
    const lane = page.getByTestId(`box-lane-${overUserId}`);
    await expect(lane).toBeVisible();
    await expect(lane).toHaveAttribute('data-count', /[1-9][0-9]*/);
  });
});
```
> If the views e2e setup module is named differently (e.g. inline seed in an existing `*.e2e.ts`), reuse that exact module/path — do NOT invent `helpers/views-e2e-setup` if it does not exist; replicate the existing seed pattern inline instead.
- [ ] Run the e2e spec against local Docker `ProjectFlow_Test` using the repo's e2e runner command (the same one the Views Engine e2e uses; e.g. `npm --prefix apps/next-web run test:e2e -- workload-box-views`). Expect PASS (2 tests). If the live run is environment-blocked, mark it authored + live-run-deferred and log in `DECISIONS.md` (matching the realtime/presence deferral precedent).
- [ ] Run the full slice verification: `npm --prefix apps/api run test:unit`, `npm --prefix apps/api run test:integration` (local Docker), `npm --prefix apps/next-web run test:unit`, `npm --prefix apps/api run build`, `npm --prefix apps/next-web run build` — all green.
- [ ] Commit: `test(8d): e2e — Workload flags over-capacity assignee; Box groups by assignee`.

---

## Definition of Done

- [ ] `ViewType` includes `'workload'` and `'box'`; both are registered + dispatched in `view-surface.tsx`. **No DB migration was added** — capacity is computed live from existing 8a (`Tasks.TimeEstimateSeconds`) + 8c (`Tasks.StoryPoints`) columns; the only persistence is config-only `SavedViews.config` keys (`capacityMetric`, `capacityPerDaySeconds`, `capacityPerSprintPoints`).
- [ ] A capacity-aggregation surface exists on **both** the GraphQL mirror (`viewCapacity`) and a REST route (`GET /views/capacity`), both delegating to one shared `viewService.capacity()` built on the existing Phase 3 query compiler (no new task-query SQL beyond the per-assignee SUM).
- [ ] The aggregation endpoint is **fail-closed**: node scopes require object-level `VIEW` (`requireObjectLevel` / `accessService.resolveOrNull`); EVERYTHING requires the `workspace.read` slug; unresolvable scope → 404, no access → 403.
- [ ] A **pure, unit-tested** capacity classifier (`classifyCapacity` → over/at/under + ratio) and a pure aggregation fold (`aggregateCapacity`) exist and pass unit tests.
- [ ] **Unit:** capacity classification + per-assignee aggregation fold (API), `WorkloadView` over-capacity flag + `BoxView` assignee grouping (web) — all green.
- [ ] **Integration:** the capacity endpoint sums estimates + points correctly within scope + date range and flags over-capacity, verified against local Docker `ProjectFlow_Test` (never the prod-pointing `apps/api/.env`).
- [ ] **e2e (≥1 headline flow):** opening the Workload view flags an over-loaded assignee; the Box view groups tasks into per-assignee swimlanes (authored; live-run deferral logged in `DECISIONS.md` if environment-blocked).
- [ ] Workload view: per-assignee capacity bars (hours/day or points/sprint, configurable via config keys) vs assigned estimates over a date range, over-capacity assignees flagged by color + badge.
- [ ] Box view: board grouped into per-assignee swimlanes (assignee grouping mirrors `board-view-engine.tsx`) with card counts per assignee.
- [ ] `@projectflow/types` updated (`ViewType` + `CapacityMetric`/`CapacityStatus`/`CapacityRow`/`CapacityResult` + `ViewConfig` capacity keys); all new UI strings added to `en.json` + `id.json` with the `messages.unit` parity test green.
- [ ] `npm --prefix apps/api run build` and `npm --prefix apps/next-web run build` both clean; a `DECISIONS.md` entry logs any deviations (notably: Views Engine is GraphQL-first, so the REST `GET /views/capacity` route is the spec-mandated mirror added alongside the canonical GraphQL `viewCapacity`).

> **Acceptance (BUILD_PLAN §7.4):**
> - [ ] **Workload view flags over-capacity assignees.**
