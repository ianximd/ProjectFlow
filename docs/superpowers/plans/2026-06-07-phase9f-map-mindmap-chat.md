# Phase 9f — Map, Mind Map & Chat Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the final three remaining view types to the Views Engine — **Map**, **Mind Map**, and **Chat** — plus the greenfield `location` custom-field type the Map view needs. Map plots tasks that carry a `location` custom-field value (`{lat,lng,label}`) on a free OpenStreetMap tile map (pin → task panel). Mind Map renders the `parent_task_id` subtree under the view scope as an expand/collapse node graph (reusing the Phase 1 descendant query). Chat renders a task's comment stream as a channel-style feed with inline compose (reusing the Phase 4 comment-create path + the existing comment components). No new tables: Map adds one CHECK-widening migration (`0050`) for the `location` field type; Mind Map and Chat read existing data and store only `config`.

**Architecture:** Each renderer is a **client lens over the same compiled task query** the four existing views already use — no parallel data path (spec §2.2). The Views read path is GraphQL-only (`viewTasks`/`runView` → Phase 3 compiler → `ViewRepository.queryTasks`), and each task row already carries its decoded `customFieldValues` map. **Map** reuses `viewTasks` unchanged and reads each task's `location` value client-side; a small backend filter helper returns only located tasks for the headline acceptance and a dedicated `mapTasks` query. **Mind Map** adds a `mindMapGraph(viewId)` GraphQL resolver that runs `usp_Hierarchy_DescendantTasks` over the view's scope node and shapes the rows into a pure node/edge graph (the graph build is a pure, unit-tested helper). **Chat** adds a `chatChannel(taskId)`/`postChatMessage` thin GraphQL pair that delegates to the existing `commentService.list`/`commentService.create` — posting reuses the exact comment-create path (mentions, watchers, fan-out, realtime publish). `view-surface.tsx` registers `MapView`/`MindMapView`/`ChatView` in its `ViewBody` switch (the registry 9d expanded). The `location` field-type token is added to the `0030`/`0035` `CK_CustomFields_Type` lineage (migration `0050`), the `CustomFieldType` union, and the Phase 2 `validators.ts` (lat ∈ [-90,90], lng ∈ [-180,180], optional string `label`).

**Tech Stack:** SQL Server stored procedures + a CHECK-widening migration (`CREATE OR ALTER`, idempotent drop-then-recreate of the constraint); Hono REST + graphql-yoga/Pothos (`@pothos/core`) GraphQL mirror; `mssql` via `execSp`/`execSpOne`; vitest (`--project unit` / `--project integration`); Next.js App Router (SSR) + `next-intl`; `leaflet` + `react-leaflet` (OpenStreetMap tiles, no paid key — new dependency, installed in Task 8); Playwright e2e. DB work runs ONLY against local Docker `ProjectFlow_Test`.

**Prerequisite:** Phase 9d merged (the `ViewType` union + `CK_SavedViews_Type` CHECK already expanded to the full set incl. `map`/`mindmap`/`chat`); Phase 4 comments (comment-create path + `CommentSection` components); Phase 1 hierarchy (`usp_Hierarchy_DescendantTasks` descendant query); Phase 2 custom fields (`CustomFields` table + `CK_CustomFields_Type` CHECK + `validators.ts`).

---

## File Structure

**Migration: `location` field type** (`infra/sql/migrations/`)
- `0050_location_field.sql` — **Create.** Idempotent, GO-batched: drop-then-recreate `CK_CustomFields_Type` to append `'location'` to the exact `0035` list (`0030` list + `relationship`/`rollup` + `location`). No other DDL.
- `rollback/0050_location_field.down.sql` — **Create.** Reverse: drop-then-recreate `CK_CustomFields_Type` back to the `0035` list (without `location`). Note: re-adding the narrower CHECK fails if any `location` row exists — delete those first (destructive; not automatic).

**API: Map + MindMap + Chat resolvers + `location` validator** (`apps/api/src/`)
- `modules/customfields/validators.ts` — **Modify.** Add a `case 'location'` to `validateFieldValue` (lat/lng range + optional string label).
- `modules/customfields/__tests__/validators.unit.test.ts` — **Modify.** Add `location` value-validation cases.
- `modules/views/view.service.ts` — **Modify.** Add `mapTasks(userId, viewId, opts)` (located-only filter over `runView`) and `mindMapGraph(userId, viewId)` (descendant-query → pure graph build).
- `modules/views/mindmap.ts` — **Create.** Pure `buildMindMapGraph(rows, rootScope)` node/edge builder.
- `modules/views/__tests__/mindmap.unit.test.ts` — **Create.** Pure graph-build unit tests.
- `modules/views/view.repository.ts` — **Modify.** Add `descendantTasks(scopeType, scopeId)` (calls `usp_Hierarchy_DescendantTasks`).
- `graphql/views.schema.ts` — **Modify.** Add `mapTasks`/`mindMapGraph` queries + `MindMapNodeType`/`MindMapEdgeType`/`MindMapGraphType` object refs.
- `graphql/chat.schema.ts` — **Create.** `registerChatGraphql()`: `chatChannel(taskId)` query + `postChatMessage(taskId, body)` mutation, delegating to `commentService`.
- `graphql/schema.ts` — **Modify.** Import + call `registerChatGraphql()`.

**Types: `location` field value shape + view payloads** (`packages/types/`)
- `index.ts` — **Modify.** Add `'location'` to `CustomFieldType`; add `LocationValue` (`{lat,lng,label}`); add `MindMapNode`/`MindMapEdge`/`MindMapGraph`.

**Frontend: view-surface registrations + Map + MindMap + Chat renderers** (`apps/next-web/src/`)
- `components/views/view-surface.tsx` — **Modify.** Import + register `MapView`/`MindMapView`/`ChatView` in the `ViewBody` switch.
- `components/views/map-view.tsx` — **Create.** OpenStreetMap tile map plotting located tasks; click pin → task panel.
- `components/views/map-view.module.css` — **Create.** Map container + panel styles.
- `components/views/mind-map-view.tsx` — **Create.** Tree node graph with expand/collapse.
- `components/views/mind-map-view.module.css` — **Create.** Node/edge styles.
- `components/views/chat-view.tsx` — **Create.** Channel-style comment stream + inline compose (reuses `CommentSection`).
- `server/queries/views.ts` — **Modify.** Add `getMapTasks(viewId)` + `getMindMapGraph(viewId)` SSR helpers (GraphQL).
- `lib/location.ts` — **Create.** Pure `parseLocationValue(raw)` (decode the stored `customFieldValues` entry → `LocationValue | null`).

**i18n**
- `messages/en.json` — **Modify.** Add `Map`, `MindMap`, `ChatView` namespaces.
- `messages/id.json` — **Modify.** Same keys, real Indonesian.

**Tests**
- `apps/api/src/modules/customfields/__tests__/validators.unit.test.ts` — **Modify** (above).
- `apps/api/src/modules/views/__tests__/mindmap.unit.test.ts` — **Create** (above).
- `apps/api/src/modules/views/__tests__/map-mindmap-chat.integration.test.ts` — **Create.** Map returns only located tasks in scope; a Chat post creates a real comment; Mind Map returns the subtree graph.
- `apps/next-web/e2e/map-mindmap-chat.spec.ts` — **Create.** Set a task's location → see the pin on Map; expand the Mind Map; post in Chat view.

---

## Tasks

### Task 1: Migration + rollback (`0050_location_field.sql`)

**Files:**
- Create: `infra/sql/migrations/0050_location_field.sql`
- Create: `infra/sql/migrations/rollback/0050_location_field.down.sql`
- Test: manual deploy against local Docker `ProjectFlow_Test` (migrations have no unit harness; verified via the integration suite in Task 7).

Steps:

- [ ] Write the migration. Idempotent (drop-then-recreate the CHECK under a `sys.check_constraints` guard), GO-batched, matching the `0035` drop-then-recreate style. The CHECK list below is the EXACT `0035` list (the `0030` list + `relationship` + `rollup`) with `'location'` appended:

```sql
-- =============================================================================
-- Migration 0050: Location custom-field type (Phase 9f)
-- Adds 'location' to CK_CustomFields_Type so the Map view can plot tasks by a
-- per-task { "lat": number, "lng": number, "label": string } JSON value stored
-- in TaskCustomFieldValues.Value. The list below is the EXACT 0035 list with
-- 'location' appended; drop the old constraint (guarded) then re-add. WITH
-- NOCHECK is unnecessary — we are only WIDENING the allowed set, so every
-- existing CustomFields row still satisfies the new constraint.
-- Idempotent (sys-catalog guard), GO-batched.
-- Rollback in rollback/0050_location_field.down.sql.
-- =============================================================================

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CustomFields_Type')
    ALTER TABLE dbo.CustomFields DROP CONSTRAINT CK_CustomFields_Type;
GO
ALTER TABLE dbo.CustomFields ADD CONSTRAINT CK_CustomFields_Type CHECK (Type IN (
    'text','text_area','number','currency','checkbox','date','url','email','phone',
    'dropdown','labels','rating','people','progress_manual','progress_auto',
    'relationship','rollup','location'));
GO
```

- [ ] Write the rollback `rollback/0050_location_field.down.sql` — restore the `0035` CHECK (without `location`):

```sql
-- Rollback 0050: location custom-field type.
-- Restores CK_CustomFields_Type to the 0035 list (without 'location'). NOTE:
-- re-adding the narrower CHECK will FAIL if any CustomFields row still uses the
-- 'location' type — delete those rows first in that case (destructive; not done
-- automatically here, mirroring the 0035 rollback note).

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CustomFields_Type')
    ALTER TABLE dbo.CustomFields DROP CONSTRAINT CK_CustomFields_Type;
GO
ALTER TABLE dbo.CustomFields ADD CONSTRAINT CK_CustomFields_Type CHECK (Type IN (
    'text','text_area','number','currency','checkbox','date','url','email','phone',
    'dropdown','labels','rating','people','progress_manual','progress_auto',
    'relationship','rollup'));
GO
```

- [ ] Run against local Docker `ProjectFlow_Test` only (explicit local DB env, never `apps/api/.env`). Run: apply `0050_location_field.sql` then immediately the `.down.sql` then re-apply `0050` to prove idempotency + reversibility. Expected: all three runs succeed with no errors; the re-applied `0050` is a clean drop-then-recreate (no constraint-violation, since no `location` row exists yet).

- [ ] Commit:
```
git add infra/sql/migrations/0050_location_field.sql infra/sql/migrations/rollback/0050_location_field.down.sql
git commit -m "feat(9f): location custom-field type migration — widen CK_CustomFields_Type"
```

---

### Task 2: Types — `location` value shape + Mind Map graph + `CustomFieldType`

**Files:**
- Modify: `packages/types/index.ts` (the `CustomFieldType` union ~line 850; the Views Engine block ~line 972)

Steps:

- [ ] Add `'location'` to the `CustomFieldType` union (append after `rollup`):

```ts
export type CustomFieldType =
  | 'text' | 'text_area' | 'number' | 'currency' | 'checkbox' | 'date'
  | 'url' | 'email' | 'phone' | 'dropdown' | 'labels' | 'rating'
  | 'people' | 'progress_manual' | 'progress_auto'
  // Phase 5b: link tasks (relationship) + read-only aggregate over linked tasks (rollup).
  | 'relationship' | 'rollup'
  // Phase 9f: a geographic point for the Map view.
  | 'location';
```

- [ ] Add the `location` value shape next to `RelationshipRef` (after the `CustomFieldConfig`/`RelationshipRef` block):

```ts
/** A `location` custom-field value (Phase 9f). Stored as JSON in
 *  TaskCustomFieldValues.Value; the Map view plots `lat`/`lng` and labels the
 *  pin with `label`. */
export interface LocationValue {
  lat:   number;   // [-90, 90]
  lng:   number;   // [-180, 180]
  label: string;   // human-readable place name (may be '')
}
```

- [ ] Add the Mind Map graph types at the end of the Views Engine block (after `ViewTaskPage`, before `BulkAction`):

```ts
// ─── Mind Map view (Phase 9f) ─────────────────────────────────────────────
// A node/edge graph of the parent_task_id subtree under a view's scope node.
// The root is the scope node itself; nodes are tasks; edges are parent→child.
export interface MindMapNode {
  id:       string;        // task id
  title:    string;
  status:   string;
  parentId: string | null; // ParentTaskId, or null at a subtree root
  depth:    number;        // 0 = a root task directly under the scope
}
export interface MindMapEdge { from: string; to: string }   // parent id → child id
export interface MindMapGraph { nodes: MindMapNode[]; edges: MindMapEdge[]; rootIds: string[] }
```

- [ ] Run: `npm run build --workspace packages/types` (tsc). Expected: PASS — no type errors.

- [ ] Commit:
```
git add packages/types/index.ts
git commit -m "feat(9f): types — location field value + CustomFieldType 'location' + MindMap graph"
```

---

### Task 3: `location` field validator + unit tests

**Files:**
- Modify: `apps/api/src/modules/customfields/validators.ts`
- Modify: `apps/api/src/modules/customfields/__tests__/validators.unit.test.ts`

Steps:

- [ ] Write the failing unit tests first — append `location` cases to the existing `describe('validateFieldValue', …)` block in `validators.unit.test.ts`:

```ts
  it('location accepts a valid lat/lng with an optional label', () => {
    expect(ok('location', { lat: 0, lng: 0, label: 'Null Island' }).valid).toBe(true);
    expect(ok('location', { lat: -89.9, lng: 179.9, label: '' }).valid).toBe(true);
    expect(ok('location', { lat: 90, lng: -180, label: 'edge' }).valid).toBe(true);
  });
  it('location rejects a non-object value', () => {
    expect(ok('location', 'here').valid).toBe(false);
    expect(ok('location', null).code).toBe('NOT_LOCATION');
  });
  it('location rejects a latitude outside [-90, 90]', () => {
    expect(ok('location', { lat: 91, lng: 0, label: '' }).valid).toBe(false);
    expect(ok('location', { lat: 91, lng: 0, label: '' }).code).toBe('BAD_LATITUDE');
    expect(ok('location', { lat: -90.1, lng: 0, label: '' }).valid).toBe(false);
  });
  it('location rejects a longitude outside [-180, 180]', () => {
    expect(ok('location', { lat: 0, lng: 181, label: '' }).valid).toBe(false);
    expect(ok('location', { lat: 0, lng: 181, label: '' }).code).toBe('BAD_LONGITUDE');
    expect(ok('location', { lat: 0, lng: -180.5, label: '' }).valid).toBe(false);
  });
  it('location rejects a non-finite lat/lng (NaN/Infinity)', () => {
    expect(ok('location', { lat: Number.NaN, lng: 0, label: '' }).valid).toBe(false);
    expect(ok('location', { lat: 0, lng: Number.POSITIVE_INFINITY, label: '' }).valid).toBe(false);
  });
  it('location rejects a non-string label', () => {
    expect(ok('location', { lat: 0, lng: 0, label: 42 }).valid).toBe(false);
    expect(ok('location', { lat: 0, lng: 0, label: 42 }).code).toBe('BAD_LABEL');
  });
```

- [ ] Run: `npm test --workspace apps/api -- validators`. Expected: FAIL — `location` falls through to the `default: UNKNOWN_TYPE` branch, so the "accepts valid" case fails.

- [ ] Add the `case 'location'` to `validateFieldValue` in `validators.ts`, placed after `case 'rollup'` and before `default`. (`isFiniteNumber` and `isString` already exist at the top of the file.):

```ts
    case 'location': {
      if (typeof value !== 'object' || value === null || Array.isArray(value))
        return fail('NOT_LOCATION', 'Value must be a { lat, lng, label } object');
      const v = value as Record<string, unknown>;
      if (!isFiniteNumber(v.lat) || v.lat < -90 || v.lat > 90)
        return fail('BAD_LATITUDE', 'lat must be a finite number between -90 and 90');
      if (!isFiniteNumber(v.lng) || v.lng < -180 || v.lng > 180)
        return fail('BAD_LONGITUDE', 'lng must be a finite number between -180 and 180');
      if (!isString(v.label))
        return fail('BAD_LABEL', 'label must be a string');
      return okResult;
    }
```

- [ ] Run: `npm test --workspace apps/api -- validators`. Expected: PASS (existing cases + 6 new `location` cases). Then `npm run build --workspace apps/api` (tsc — confirms the `CustomFieldType` switch is still exhaustive with the new member). Expected: PASS.

- [ ] Commit:
```
git add apps/api/src/modules/customfields/validators.ts apps/api/src/modules/customfields/__tests__/validators.unit.test.ts
git commit -m "feat(9f): location field value validation — lat/lng ranges + label + unit tests"
```

---

### Task 4: Pure Mind Map graph builder + unit tests

**Files:**
- Create: `apps/api/src/modules/views/mindmap.ts`
- Create: `apps/api/src/modules/views/__tests__/mindmap.unit.test.ts`

Steps:

- [ ] Write the failing unit test first. The builder takes the raw descendant rows (PascalCase `usp_Hierarchy_DescendantTasks` output: `Id`, `ParentTaskId`, `Title`, `Status`) plus the set of ids that are in-scope, and returns nodes (depth-stamped), edges (parent→child where the parent is itself in the subtree), and `rootIds` (in-scope tasks whose parent is NOT in the subtree). `mindmap.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildMindMapGraph, type DescendantRow } from '../mindmap.js';

const row = (Id: string, ParentTaskId: string | null, Title = Id, Status = 'OPEN'): DescendantRow =>
  ({ Id, ParentTaskId, Title, Status });

describe('buildMindMapGraph', () => {
  it('builds a single-root tree with depth and parent→child edges', () => {
    const rows = [
      row('a', null),
      row('b', 'a'),
      row('c', 'a'),
      row('d', 'b'),
    ];
    const g = buildMindMapGraph(rows);
    expect(g.rootIds).toEqual(['a']);
    expect(g.nodes.find((n) => n.id === 'a')!.depth).toBe(0);
    expect(g.nodes.find((n) => n.id === 'b')!.depth).toBe(1);
    expect(g.nodes.find((n) => n.id === 'd')!.depth).toBe(2);
    expect(g.edges).toContainEqual({ from: 'a', to: 'b' });
    expect(g.edges).toContainEqual({ from: 'a', to: 'c' });
    expect(g.edges).toContainEqual({ from: 'b', to: 'd' });
  });

  it('treats a child whose parent is OUTSIDE the subtree as a root (depth 0)', () => {
    // 'b' references parent 'x' which is not among the rows (scope starts below x).
    const rows = [row('b', 'x'), row('d', 'b')];
    const g = buildMindMapGraph(rows);
    expect(g.rootIds).toEqual(['b']);
    expect(g.nodes.find((n) => n.id === 'b')!.depth).toBe(0);
    expect(g.nodes.find((n) => n.id === 'b')!.parentId).toBeNull(); // re-rooted
    expect(g.nodes.find((n) => n.id === 'd')!.depth).toBe(1);
    expect(g.edges).toEqual([{ from: 'b', to: 'd' }]);
  });

  it('supports multiple roots and is cycle-safe (a self/back-reference does not loop)', () => {
    const rows = [row('a', null), row('b', null), row('c', 'a'), row('a2', 'a2')];
    const g = buildMindMapGraph(rows);
    expect(g.rootIds.sort()).toEqual(['a', 'a2', 'b']); // a2's parent is itself → re-rooted
    expect(g.nodes).toHaveLength(4);
    expect(g.nodes.every((n) => n.depth >= 0)).toBe(true);
  });

  it('returns an empty graph for no rows', () => {
    expect(buildMindMapGraph([])).toEqual({ nodes: [], edges: [], rootIds: [] });
  });
});
```

- [ ] Run: `npm test --workspace apps/api -- mindmap`. Expected: FAIL — `Cannot find module '../mindmap.js'`.

- [ ] Write `apps/api/src/modules/views/mindmap.ts`:

```ts
import type { MindMapGraph, MindMapNode, MindMapEdge } from '@projectflow/types';

/** Raw row from usp_Hierarchy_DescendantTasks (SELECT t.* → PascalCase). Only
 *  the four columns the graph needs are declared; extra columns are ignored. */
export interface DescendantRow {
  Id:           string;
  ParentTaskId: string | null;
  Title:        string;
  Status:       string;
}

/**
 * Build a parent→child node/edge graph from a flat descendant set.
 *
 * A node is a ROOT when its ParentTaskId is null OR points outside the returned
 * set (the scope began below that ancestor). Roots are re-rooted (parentId set
 * to null, depth 0). Depth is computed by BFS from the roots; the visited guard
 * makes the walk cycle-safe even if the data contains a self/back reference.
 * Pure — no DB, no clock — so it is fully unit-testable.
 */
export function buildMindMapGraph(rows: DescendantRow[]): MindMapGraph {
  const ids = new Set(rows.map((r) => r.Id));
  const childrenOf = new Map<string, string[]>();
  const rootIds: string[] = [];

  for (const r of rows) {
    const hasInScopeParent = r.ParentTaskId !== null && r.ParentTaskId !== r.Id && ids.has(r.ParentTaskId);
    if (hasInScopeParent) {
      const arr = childrenOf.get(r.ParentTaskId!) ?? [];
      arr.push(r.Id);
      childrenOf.set(r.ParentTaskId!, arr);
    } else {
      rootIds.push(r.Id);
    }
  }

  const meta = new Map(rows.map((r) => [r.Id, r] as const));
  const nodes: MindMapNode[] = [];
  const edges: MindMapEdge[] = [];
  const visited = new Set<string>();

  // BFS from each root so depth is the shortest hop count and cycles terminate.
  const queue: Array<{ id: string; parentId: string | null; depth: number }> =
    rootIds.map((id) => ({ id, parentId: null, depth: 0 }));
  while (queue.length) {
    const { id, parentId, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const r = meta.get(id)!;
    nodes.push({ id, title: r.Title, status: r.Status, parentId, depth });
    if (parentId !== null) edges.push({ from: parentId, to: id });
    for (const childId of childrenOf.get(id) ?? []) {
      if (!visited.has(childId)) queue.push({ id: childId, parentId: id, depth: depth + 1 });
    }
  }

  return { nodes, edges, rootIds };
}
```

- [ ] Run: `npm test --workspace apps/api -- mindmap`. Expected: PASS (4 tests).

- [ ] Commit:
```
git add apps/api/src/modules/views/mindmap.ts apps/api/src/modules/views/__tests__/mindmap.unit.test.ts
git commit -m "feat(9f): pure mind-map graph builder (descendant rows → node/edge graph) + unit tests"
```

---

### Task 5: View repository + service — Map (located filter) + Mind Map (descendant graph)

**Files:**
- Modify: `apps/api/src/modules/views/view.repository.ts`
- Modify: `apps/api/src/modules/views/view.service.ts`

Steps:

- [ ] Add a `descendantTasks` method to `ViewRepository` (calls the Phase 1 `usp_Hierarchy_DescendantTasks` SP; returns the raw PascalCase rows the graph builder consumes). Match the file's existing `execSp` import/usage:

```ts
  /** Phase 1 descendant query — every task under a SPACE/FOLDER/LIST node, by
   *  ListPath prefix. Returns raw SELECT t.* rows (PascalCase) for the Mind Map
   *  graph builder. */
  async descendantTasks(scopeType: 'SPACE' | 'FOLDER' | 'LIST', scopeId: string): Promise<any[]> {
    return execSp('usp_Hierarchy_DescendantTasks', [
      { name: 'NodeType', type: sql.NVarChar(8),      value: scopeType },
      { name: 'NodeId',   type: sql.UniqueIdentifier, value: scopeId },
    ]);
  }
```

- [ ] Add `mapTasks` + `mindMapGraph` to `ViewService` (import `buildMindMapGraph`, `parseLocationValue` and the types). `mapTasks` runs the view through the existing `runView` (Phase 3 compiler) — full object-level scoping — and keeps only rows whose `location` field value decodes to a valid `{lat,lng}`. `mindMapGraph` resolves the view's scope node and runs the descendant query, then the pure builder. Add a private decode helper for the per-row `CustomFieldValues` map (the same `{ [lowercasedFieldId]: rawValue }` shape `ViewRepository.queryTasks` populates):

```ts
  /**
   * Map view data: the view's compiled task page (Phase 3 compiler, fully
   * object-level scoped) filtered to tasks that carry a VALID `location`
   * custom-field value. Returns each kept task plus its decoded LocationValue.
   */
  async mapTasks(
    userId: string,
    viewId: string,
    opts: { page: number; pageSize?: number; meMode?: boolean },
  ): Promise<{ taskId: string; title: string; status: string; location: LocationValue }[]> {
    const view = await this.getOrThrow(viewId);
    // Locate the scope's 'location' fields so we know which CustomFieldValues
    // keys to read (a scope may have more than one location field).
    const fields = view.scopeType !== 'EVERYTHING' && view.scopeId
      ? await this.cfRepo.list(view.scopeType as any, view.scopeId)
      : [];
    const locationFieldIds = fields.filter((f) => f.type === 'location').map((f) => f.id.toLowerCase());

    const page = await this.runView(userId, viewId, opts);
    const out: { taskId: string; title: string; status: string; location: LocationValue }[] = [];
    for (const t of page.tasks as any[]) {
      const cfv = (t.CustomFieldValues ?? t.customFieldValues ?? {}) as Record<string, unknown>;
      for (const fid of locationFieldIds) {
        const loc = parseLocationValue(cfv[fid]);
        if (loc) { out.push({ taskId: t.Id ?? t.id, title: t.Title ?? t.title, status: t.Status ?? t.status, location: loc }); break; }
      }
    }
    return out;
  }

  /** Mind Map view data: the parent_task_id subtree under the view's scope node,
   *  shaped into a node/edge graph. EVERYTHING scope has no single node → empty. */
  async mindMapGraph(userId: string, viewId: string): Promise<MindMapGraph> {
    const view = await this.getOrThrow(viewId);
    if (view.scopeType === 'EVERYTHING' || !view.scopeId) return { nodes: [], edges: [], rootIds: [] };
    // Object-level read gate is enforced by the GraphQL resolver (requireObjectLevel)
    // before this runs; here we only fetch + shape.
    const rows = await this.repo.descendantTasks(view.scopeType as 'SPACE' | 'FOLDER' | 'LIST', view.scopeId);
    return buildMindMapGraph(rows as any);
  }
```

Add at the top of `view.service.ts` (alongside the existing imports):

```ts
import { buildMindMapGraph } from './mindmap.js';
import { parseLocationValue } from './location.js';
import type { LocationValue, MindMapGraph } from '@projectflow/types';
```

- [ ] Add a server-side `parseLocationValue` for the service (mirrors the web `lib/location.ts` but lives in the API module to avoid a cross-package import). Create `apps/api/src/modules/views/location.ts`:

```ts
import type { LocationValue } from '@projectflow/types';

/** Decode a raw stored `location` value (JSON string or already-parsed object)
 *  into a validated LocationValue, or null when missing/invalid. Mirrors the
 *  Phase 2 validator's range checks so the Map view never plots a bad pin. */
export function parseLocationValue(raw: unknown): LocationValue | null {
  if (raw == null) return null;
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try { v = JSON.parse(raw); } catch { return null; }
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const lat = typeof o.lat === 'number' ? o.lat : Number(o.lat);
  const lng = typeof o.lng === 'number' ? o.lng : Number(o.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  const label = typeof o.label === 'string' ? o.label : '';
  return { lat, lng, label };
}
```

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: PASS — no type errors.

- [ ] Commit:
```
git add apps/api/src/modules/views/view.repository.ts apps/api/src/modules/views/view.service.ts apps/api/src/modules/views/location.ts
git commit -m "feat(9f): view service — mapTasks (located filter) + mindMapGraph (descendant subtree)"
```

---

### Task 6: GraphQL — Map + Mind Map queries + Chat schema

**Files:**
- Modify: `apps/api/src/graphql/views.schema.ts`
- Create: `apps/api/src/graphql/chat.schema.ts`
- Modify: `apps/api/src/graphql/schema.ts`

Steps:

- [ ] Add `mapTasks` + `mindMapGraph` queries to `views.schema.ts`. Define the object refs near the top of `registerViewsGraphql` (or wherever the other `builder.objectRef` calls live), and add the two query fields inside the existing `builder.queryFields((t) => ({ … }))`. Both gate with `requireObjectLevel` exactly like `viewTasks` (resolve the view, derive its scope node, require `VIEW`). Mirror the `viewTasks` resolver's `userId`/authz pattern already in the file:

```ts
// ── Map view: located tasks for a saved view ──────────────────────────────
const MapTaskType = builder.objectRef<{ taskId: string; title: string; status: string; location: { lat: number; lng: number; label: string } }>('MapTask');
MapTaskType.implement({ fields: (t) => ({
  taskId: t.exposeString('taskId'),
  title:  t.exposeString('title'),
  status: t.exposeString('status'),
  lat:    t.float({ resolve: (m) => m.location.lat }),
  lng:    t.float({ resolve: (m) => m.location.lng }),
  label:  t.string({ resolve: (m) => m.location.label }),
}) });

// ── Mind Map view: parent→child subtree graph ─────────────────────────────
const MindMapNodeType = builder.objectRef<import('@projectflow/types').MindMapNode>('MindMapNode');
MindMapNodeType.implement({ fields: (t) => ({
  id:       t.exposeString('id'),
  title:    t.exposeString('title'),
  status:   t.exposeString('status'),
  parentId: t.string({ nullable: true, resolve: (n) => n.parentId }),
  depth:    t.exposeInt('depth'),
}) });
const MindMapEdgeType = builder.objectRef<import('@projectflow/types').MindMapEdge>('MindMapEdge');
MindMapEdgeType.implement({ fields: (t) => ({ from: t.exposeString('from'), to: t.exposeString('to') }) });
const MindMapGraphType = builder.objectRef<import('@projectflow/types').MindMapGraph>('MindMapGraph');
MindMapGraphType.implement({ fields: (t) => ({
  nodes:   t.field({ type: [MindMapNodeType], resolve: (g) => g.nodes }),
  edges:   t.field({ type: [MindMapEdgeType], resolve: (g) => g.edges }),
  rootIds: t.stringList({ resolve: (g) => g.rootIds }),
}) });
```

Add these two fields inside the existing `builder.queryFields((t) => ({ … }))` (next to `viewTasks`). Reuse the same `requireObjectLevel`/scope-node helpers `viewTasks` uses — fetch the view via `viewService`, derive `authzNode(view.scopeType)` + `view.scopeId`, and require `VIEW`:

```ts
    mapTasks: t.field({
      type: [MapTaskType],
      args: { viewId: t.arg.string({ required: true }), page: t.arg.int(), meMode: t.arg.boolean() },
      resolve: async (_, a, ctx) => {
        const userId = requireUserId(ctx);                       // same helper viewTasks uses
        const view = await viewService.getByIdForRead(a.viewId); // resolves + throws ViewNotFound
        await requireObjectLevel(ctx, authzNode(view.scopeType), view.scopeId, 'VIEW');
        return viewService.mapTasks(userId, a.viewId, { page: a.page ?? 1, meMode: a.meMode ?? undefined });
      },
    }),
    mindMapGraph: t.field({
      type: MindMapGraphType,
      args: { viewId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const userId = requireUserId(ctx);
        const view = await viewService.getByIdForRead(a.viewId);
        await requireObjectLevel(ctx, authzNode(view.scopeType), view.scopeId, 'VIEW');
        return viewService.mindMapGraph(userId, a.viewId);
      },
    }),
```

> NOTE (read the file first): use the **exact** `userId`/view-fetch helpers `viewTasks` already calls in `views.schema.ts` (e.g. the resolver reads `ctx.user` and `viewService.runView(userId, …)`). If there is no `getByIdForRead`, fetch the view with whatever read-accessor `viewTasks`/`updateSavedView` use (e.g. `viewService.getOrThrow`) and require `VIEW` on its node before delegating. The shape above is the contract; bind it to the real helpers in the file.

- [ ] Write `apps/api/src/graphql/chat.schema.ts` — a thin mirror over `commentService` so a Chat view streams + posts comments through the **exact** existing comment-create path (mentions, watchers, fan-out, `comment:created` realtime publish all happen inside `commentService.create`). Model authz on the comment routes (`comment.create` to post; `LIST`-level `VIEW` to read):

```ts
import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { commentService } from '../modules/comments/comment.service.js';
import { TaskRepository } from '../modules/tasks/task.repository.js';
import { requireObjectLevel, requireWorkspacePermission } from './authz.js';
import type { Comment } from '@projectflow/types';

const taskRepo = new TaskRepository();
async function taskListId(taskId: string): Promise<string | null> {
  const t = await taskRepo.getById(taskId);
  return (t as any)?.listId ?? (t as any)?.ListId ?? null;
}

export function registerChatGraphql(): void {
  const ChatMessageType = builder.objectRef<Comment>('ChatMessage');
  ChatMessageType.implement({ fields: (t) => ({
    id:        t.exposeString('id'),
    taskId:    t.exposeString('taskId'),
    authorId:  t.exposeString('authorId'),
    body:      t.exposeString('body'),
    createdAt: t.field({ type: 'Date', resolve: (c) => new Date(c.createdAt) }),
  }) });

  builder.queryFields((t) => ({
    // A task's comment stream as a chat channel (reverse-chron handled client-side).
    chatChannel: t.field({
      type: [ChatMessageType],
      args: { taskId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const workspaceId = await taskRepo.getWorkspaceId(a.taskId);
        if (!workspaceId) throw new GraphQLError('Task not found', { extensions: { code: 'NOT_FOUND' } });
        await requireObjectLevel(ctx, 'LIST', await taskListId(a.taskId), 'VIEW');
        return commentService.list(a.taskId);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    // Post a chat message = create a comment (reuses the full comment-create path).
    postChatMessage: t.field({
      type: ChatMessageType,
      args: { taskId: t.arg.string({ required: true }), body: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
        const workspaceId = await taskRepo.getWorkspaceId(a.taskId);
        if (!workspaceId) throw new GraphQLError('Task not found', { extensions: { code: 'NOT_FOUND' } });
        await requireWorkspacePermission(ctx, workspaceId, 'comment.create');
        if (!a.body.trim()) throw new GraphQLError('body is required', { extensions: { code: 'BAD_REQUEST' } });
        return commentService.create({ taskId: a.taskId, body: a.body, parentId: null }, (ctx.user as any).userId);
      },
    }),
  }));
}
```

- [ ] Wire `registerChatGraphql()` into `schema.ts` — add the import alongside the others and call it near the other `register*Graphql()` calls:

```ts
import { registerChatGraphql } from './chat.schema.js';
```
```ts
// ─────────────────────────────────────────
// Chat view (Phase 9f) — chatChannel(taskId) + postChatMessage delegating to
// the shared commentService (full mention/watcher/fan-out/realtime path).
// ─────────────────────────────────────────
registerChatGraphql();
```

- [ ] Run: `npm run build --workspace apps/api` (tsc — compiles the Pothos schema). Expected: PASS — schema builds, no type errors. Then `npm test --workspace apps/api` (existing GraphQL authz tests still green). Expected: PASS.

- [ ] Commit:
```
git add apps/api/src/graphql/views.schema.ts apps/api/src/graphql/chat.schema.ts apps/api/src/graphql/schema.ts
git commit -m "feat(9f): GraphQL — mapTasks/mindMapGraph queries + chatChannel/postChatMessage mirror"
```

---

### Task 7: Integration test — Map located-only + Chat post + Mind Map subtree

**Files:**
- Create: `apps/api/src/modules/views/__tests__/map-mindmap-chat.integration.test.ts`

Steps:

- [ ] Write the failing integration test (copy harness imports from the existing `query-tasks.integration.test.ts` — `testServer.js`, `truncate.js`, `factories.js`, and `runGraphql`/the GraphQL request helper that file uses). It seeds a SPACE with a `location` custom field, creates two tasks (one with a valid `location` value, one without), creates a saved Map/MindMap/Chat view, and asserts:

```ts
/**
 * Phase 9f — Map / Mind Map / Chat integration coverage.
 * Exercises the new view resolvers against the REAL SQL + GraphQL stack.
 * DB SAFETY: must target local Docker ProjectFlow_Test (see e2e/README).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json, graphql } from '../../../__tests__/setup/testServer.js'; // adapt to the file's real helpers
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

async function seedScope() {
  const owner = await createTestUser({ email: `mv-${Date.now()}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, { name: 'Map Space', key: `MV${Date.now() % 100000}` });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'L', position: 0 },
  }), 201)).data;
  // A SPACE-scoped 'location' custom field.
  const field = (await json<{ data: any }>(await request('/custom-fields', {
    method: 'POST', token, json: { workspaceId: ws.Id, scopeType: 'SPACE', scopeId: space.Id, type: 'location', name: 'Office' },
  }), 201)).data;
  return { owner, token, ws, space, list, field };
}

async function createTask(token: string, projectId: string, workspaceId: string, listId: string, title: string) {
  return (await json<{ task: any }>(await request('/tasks', {
    method: 'POST', token, json: { projectId, workspaceId, title, listId },
  }), 201)).task;
}

describe('Phase 9f — Map / Mind Map / Chat', () => {
  it('mapTasks returns ONLY tasks with a valid location value in scope', async () => {
    const { token, ws, space, list, field } = await seedScope();
    const located = await createTask(token, space.Id, ws.Id, list.id, 'HQ');
    const plain   = await createTask(token, space.Id, ws.Id, list.id, 'No location');
    // Set the located task's location field value (the generic value path).
    await request(`/tasks/${located.id}/custom-fields/${field.id}`, {
      method: 'PUT', token, json: { value: { lat: -6.2, lng: 106.8, label: 'Jakarta' } },
    });
    // Create a Map saved view on the SPACE.
    const view = (await json<{ data: { savedView: any } }>(await graphql(token, /* GraphQL */ `
      mutation { createSavedView(scopeType:"SPACE", scopeId:"${space.Id}", type:"map", name:"Map", config:"{}") { id } }
    `))).data.savedView ?? (await /* fallback: use the create resolver shape in views.schema */ null);

    const res = (await json<{ data: { mapTasks: any[] } }>(await graphql(token, /* GraphQL */ `
      query { mapTasks(viewId:"${view.id}") { taskId title lat lng label } }
    `))).data.mapTasks;
    expect(res.map((r) => r.taskId)).toContain(located.id);
    expect(res.map((r) => r.taskId)).not.toContain(plain.id);
    const hq = res.find((r) => r.taskId === located.id)!;
    expect(hq.lat).toBeCloseTo(-6.2, 5);
    expect(hq.lng).toBeCloseTo(106.8, 5);
    expect(hq.label).toBe('Jakarta');
  });

  it('mindMapGraph returns the parent→child subtree under the scope', async () => {
    const { token, ws, space, list } = await seedScope();
    const parent = await createTask(token, space.Id, ws.Id, list.id, 'Parent');
    const child = (await json<{ task: any }>(await request('/tasks', {
      method: 'POST', token, json: { projectId: space.Id, workspaceId: ws.Id, title: 'Child', parentTaskId: parent.id },
    }), 201)).task;
    const view = (await json<{ data: { savedView: any } }>(await graphql(token, /* GraphQL */ `
      mutation { createSavedView(scopeType:"SPACE", scopeId:"${space.Id}", type:"mindmap", name:"MM", config:"{}") { id } }
    `))).data.savedView;
    const g = (await json<{ data: { mindMapGraph: any } }>(await graphql(token, /* GraphQL */ `
      query { mindMapGraph(viewId:"${view.id}") { nodes { id depth parentId } edges { from to } rootIds } }
    `))).data.mindMapGraph;
    expect(g.rootIds).toContain(parent.id);
    expect(g.edges).toContainEqual({ from: parent.id, to: child.id });
    expect(g.nodes.find((n: any) => n.id === child.id).depth).toBe(1);
  });

  it('postChatMessage creates a real comment that chatChannel then streams', async () => {
    const { token, ws, space, list } = await seedScope();
    const task = await createTask(token, space.Id, ws.Id, list.id, 'Chatty');
    const posted = (await json<{ data: { postChatMessage: any } }>(await graphql(token, /* GraphQL */ `
      mutation { postChatMessage(taskId:"${task.id}", body:"hello channel") { id taskId body } }
    `))).data.postChatMessage;
    expect(posted.body).toBe('hello channel');
    // It is a real comment — visible on the REST comment list too.
    const comments = (await json<{ data: any[] }>(await request(`/comments?taskId=${task.id}`, { token }))).data;
    expect(comments.map((c) => c.id)).toContain(posted.id);
    // And streamed by chatChannel.
    const channel = (await json<{ data: { chatChannel: any[] } }>(await graphql(token, /* GraphQL */ `
      query { chatChannel(taskId:"${task.id}") { id body } }
    `))).data.chatChannel;
    expect(channel.map((m) => m.id)).toContain(posted.id);
  });
});
```

> NOTE: adapt the GraphQL request helper (`graphql(token, query)`) and the `createSavedView` result shape to whatever `query-tasks.integration.test.ts` / the views schema actually expose (the create-view mutation in `views.schema.ts` returns the new view's `id`). The custom-field value endpoint (`PUT /tasks/:taskId/custom-fields/:fieldId`) should match the Phase 2 value route — confirm the exact path/verb in `customfield.routes.ts` and the `tasks` routes when wiring this.

- [ ] Run: `npm run test:integration --workspace apps/api -- map-mindmap-chat` against `ProjectFlow_Test`. Expected: PASS (3 tests). Then full unit: `npm test --workspace apps/api`. Expected: PASS.

- [ ] Commit:
```
git add apps/api/src/modules/views/__tests__/map-mindmap-chat.integration.test.ts
git commit -m "test(9f): integration — map located-only, mindmap subtree, chat post creates a comment"
```

---

### Task 8: Install map deps + Map view renderer + SSR query + i18n

**Files:**
- Modify: `apps/next-web/package.json` (add `leaflet` + `react-leaflet`)
- Create: `apps/next-web/src/lib/location.ts`
- Create: `apps/next-web/src/components/views/map-view.tsx`
- Create: `apps/next-web/src/components/views/map-view.module.css`
- Modify: `apps/next-web/src/server/queries/views.ts`
- Modify: `apps/next-web/messages/en.json` + `id.json`
- Note: read `apps/next-web/node_modules/next/dist/docs/` per `apps/next-web/AGENTS.md` before writing web code (this Next.js has breaking changes — notably around client-only libs needing `dynamic(..., { ssr: false })`).

Steps:

- [ ] Install the OpenStreetMap tile-map deps (free tiles, no key). From the next-web workspace:

```
npm install leaflet react-leaflet --workspace apps/next-web
npm install -D @types/leaflet --workspace apps/next-web
```

Expected: `leaflet`, `react-leaflet` added to `dependencies` and `@types/leaflet` to `devDependencies` in `apps/next-web/package.json`.

- [ ] Write `apps/next-web/src/lib/location.ts` (the client-side decoder — same shape as the API `parseLocationValue`, importing the shared type):

```ts
import type { LocationValue } from '@projectflow/types';

/** Decode a task's raw `location` custom-field value (JSON string or object)
 *  into a validated LocationValue, or null when missing/invalid. */
export function parseLocationValue(raw: unknown): LocationValue | null {
  if (raw == null) return null;
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try { v = JSON.parse(raw); } catch { return null; }
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const lat = typeof o.lat === 'number' ? o.lat : Number(o.lat);
  const lng = typeof o.lng === 'number' ? o.lng : Number(o.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  const label = typeof o.label === 'string' ? o.label : '';
  return { lat, lng, label };
}
```

- [ ] Add the `getMapTasks` + `getMindMapGraph` SSR helpers to `server/queries/views.ts` (mirror the `getViewTasks` pattern — GraphQL via `gqlData`, `cache()`-wrapped):

```ts
export interface MapTaskPin { taskId: string; title: string; status: string; lat: number; lng: number; label: string }

const MAP_TASKS_QUERY = /* GraphQL */ `
  query MapTasks($viewId: String!, $meMode: Boolean) {
    mapTasks(viewId: $viewId, meMode: $meMode) { taskId title status lat lng label }
  }
`;

export const getMapTasks = cache(async (viewId: string, meMode = false): Promise<MapTaskPin[]> => {
  const { mapTasks } = await gqlData<{ mapTasks: MapTaskPin[] }>(MAP_TASKS_QUERY, { viewId, meMode });
  return mapTasks ?? [];
});

const MIND_MAP_QUERY = /* GraphQL */ `
  query MindMapGraph($viewId: String!) {
    mindMapGraph(viewId: $viewId) {
      nodes { id title status parentId depth }
      edges { from to }
      rootIds
    }
  }
`;

export const getMindMapGraph = cache(async (
  viewId: string,
): Promise<import('@projectflow/types').MindMapGraph> => {
  const { mindMapGraph } = await gqlData<{ mindMapGraph: import('@projectflow/types').MindMapGraph }>(
    MIND_MAP_QUERY, { viewId },
  );
  return mindMapGraph ?? { nodes: [], edges: [], rootIds: [] };
});
```

- [ ] Write `apps/next-web/src/components/views/map-view.tsx` — a client component that derives pins from the SSR `taskPage` (each task's `customFieldValues` carries the decoded `location`) OR, when the surface only has the generic `taskPage`, decodes the `location` custom field client-side. Plots pins on an OpenStreetMap tile map; clicking a pin opens a small task panel. `react-leaflet` is client-only — guard it with `dynamic(..., { ssr: false })`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import 'leaflet/dist/leaflet.css';
import { parseLocationValue } from '@/lib/location';
import { taskFieldValue } from './field-options';
import type { LiveScopeProp } from '@/components/views/view-surface';
import type { ViewTaskPageResult } from '@/server/queries/views';
import type { Task } from '@/server/queries/normalize-task';
import type { CustomField, LocationValue, SavedView } from '@projectflow/types';
import styles from './map-view.module.css';

// Leaflet touches `window` at import time; load the map shell client-only.
const MapContainer = dynamic(() => import('react-leaflet').then((m) => m.MapContainer), { ssr: false });
const TileLayer    = dynamic(() => import('react-leaflet').then((m) => m.TileLayer),    { ssr: false });
const Marker       = dynamic(() => import('react-leaflet').then((m) => m.Marker),       { ssr: false });
const Popup        = dynamic(() => import('react-leaflet').then((m) => m.Popup),        { ssr: false });

interface Pin { task: Task; loc: LocationValue }

interface Props {
  taskPage: ViewTaskPageResult | null;
  activeView: SavedView;
  customFields: CustomField[];
  live: LiveScopeProp;
}

export function MapView({ taskPage, customFields }: Props) {
  const t = useTranslations('Map');
  const [selected, setSelected] = useState<Task | null>(null);

  // Pins: every task whose 'location' custom-field value decodes to a valid point.
  const pins: Pin[] = useMemo(() => {
    const tasks = taskPage?.tasks ?? [];
    const locationFields = customFields.filter((f) => f.type === 'location');
    const out: Pin[] = [];
    for (const task of tasks) {
      for (const f of locationFields) {
        const raw = taskFieldValue(task, { kind: 'custom', key: f.id }, customFields);
        const loc = parseLocationValue(raw);
        if (loc) { out.push({ task, loc }); break; }
      }
    }
    return out;
  }, [taskPage, customFields]);

  // Center on the first pin, or a world view when empty.
  const center: [number, number] = pins.length ? [pins[0].loc.lat, pins[0].loc.lng] : [0, 0];
  const zoom = pins.length ? 4 : 1;

  return (
    <div data-testid="view-body-map" className={styles.root}>
      {pins.length === 0 && (
        <div className={styles.empty}>{t('noLocatedTasks')}</div>
      )}
      <MapContainer center={center} zoom={zoom} className={styles.map} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {pins.map(({ task, loc }) => (
          <Marker
            key={task.id}
            position={[loc.lat, loc.lng]}
            eventHandlers={{ click: () => setSelected(task) }}
          >
            <Popup>
              <strong>{task.title || t('untitled')}</strong>
              <div>{loc.label}</div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {selected && (
        <aside className={styles.panel} data-testid="map-task-panel">
          <button className={styles.close} onClick={() => setSelected(null)} aria-label={t('close')}>×</button>
          <h3 className={styles.panelTitle}>{selected.title || t('untitled')}</h3>
          {selected.issueKey && <div className={styles.panelKey}>{selected.issueKey}</div>}
          <div className={styles.panelStatus}>{selected.status}</div>
        </aside>
      )}
    </div>
  );
}
```

- [ ] Write `apps/next-web/src/components/views/map-view.module.css`:

```css
.root { position: relative; height: 100%; width: 100%; border-radius: 8px; overflow: hidden; border: 1px solid var(--border, #e5e7eb); }
.map { height: 100%; width: 100%; }
.empty { position: absolute; inset: 0; z-index: 500; display: flex; align-items: center; justify-content: center; pointer-events: none; color: var(--text-2, #6b7280); font-size: 13px; }
.panel { position: absolute; top: 12px; right: 12px; z-index: 600; width: 240px; padding: 12px 14px; border-radius: 8px; background: var(--surface, #fff); box-shadow: 0 6px 20px rgba(0,0,0,.18); }
.close { position: absolute; top: 6px; right: 8px; border: none; background: none; font-size: 18px; cursor: pointer; line-height: 1; }
.panelTitle { margin: 0 0 4px; font-size: 14px; font-weight: 600; }
.panelKey { font-family: ui-monospace, monospace; font-size: 11px; color: var(--text-2, #6b7280); }
.panelStatus { margin-top: 6px; font-size: 12px; }
```

- [ ] Add the `Map` namespace to `en.json` and `id.json`:

en.json:
```json
"Map": {
  "noLocatedTasks": "No tasks have a location yet",
  "untitled": "Untitled task",
  "close": "Close"
}
```
id.json:
```json
"Map": {
  "noLocatedTasks": "Belum ada tugas yang memiliki lokasi",
  "untitled": "Tugas tanpa judul",
  "close": "Tutup"
}
```

- [ ] Run: `npm test --workspace apps/next-web -- messages` (i18n parity). Expected: PASS — en/id key parity green. Then `npm run build --workspace apps/next-web`. Expected: PASS (Next build clean; the `dynamic ssr:false` keeps leaflet out of SSR).

- [ ] Commit:
```
git add apps/next-web/package.json apps/next-web/package-lock.json apps/next-web/src/lib/location.ts apps/next-web/src/components/views/map-view.tsx apps/next-web/src/components/views/map-view.module.css apps/next-web/src/server/queries/views.ts apps/next-web/messages/en.json apps/next-web/messages/id.json
git commit -m "feat(9f): Map view — OpenStreetMap tiles + pin→panel + location decode + SSR query + i18n"
```

---

### Task 9: Mind Map view renderer + i18n

**Files:**
- Create: `apps/next-web/src/components/views/mind-map-view.tsx`
- Create: `apps/next-web/src/components/views/mind-map-view.module.css`
- Modify: `apps/next-web/messages/en.json` + `id.json`
- Note: read `apps/next-web/node_modules/next/dist/docs/` before writing web code.

Steps:

- [ ] Write `apps/next-web/src/components/views/mind-map-view.tsx` — a client tree/node-graph renderer with expand/collapse. It fetches the graph for the active view (via `getMindMapGraph` exposed through a server action OR re-uses the SSR-fetched graph if threaded; here it fetches client-side from a server action that wraps the SSR query, matching the comment-section refetch pattern). Builds a children index from `edges` and renders a collapsible nested tree from `rootIds`:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { loadMindMapGraph } from '@/server/actions/views';
import type { MindMapGraph, MindMapNode, SavedView } from '@projectflow/types';
import type { ViewTaskPageResult } from '@/server/queries/views';
import type { CustomField } from '@projectflow/types';
import type { LiveScopeProp } from '@/components/views/view-surface';
import styles from './mind-map-view.module.css';

interface Props {
  taskPage: ViewTaskPageResult | null;
  activeView: SavedView;
  customFields: CustomField[];
  live: LiveScopeProp;
}

export function MindMapView({ activeView }: Props) {
  const t = useTranslations('MindMap');
  const [graph, setGraph] = useState<MindMapGraph | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    loadMindMapGraph(activeView.id).then((g) => { if (!cancelled) setGraph(g); }).catch(() => {});
    return () => { cancelled = true; };
  }, [activeView.id]);

  // Children index from edges (parent id → child ids), preserving node order.
  const childrenOf = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!graph) return map;
    for (const e of graph.edges) {
      const arr = map.get(e.from) ?? [];
      arr.push(e.to);
      map.set(e.from, arr);
    }
    return map;
  }, [graph]);

  const byId = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n] as const)), [graph]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  if (!graph) return <div className={styles.empty}>{t('loading')}</div>;
  if (graph.nodes.length === 0) return <div className={styles.empty}>{t('noNodes')}</div>;

  const renderNode = (id: string): React.ReactNode => {
    const node = byId.get(id) as MindMapNode | undefined;
    if (!node) return null;
    const kids = childrenOf.get(id) ?? [];
    const isCollapsed = collapsed.has(id);
    return (
      <li key={id} className={styles.node}>
        <div className={styles.nodeRow}>
          {kids.length > 0 ? (
            <button
              className={styles.toggle}
              onClick={() => toggle(id)}
              aria-expanded={!isCollapsed}
              aria-label={isCollapsed ? t('expand') : t('collapse')}
              data-testid="mindmap-toggle"
            >
              {isCollapsed ? '▸' : '▾'}
            </button>
          ) : (
            <span className={styles.leaf} aria-hidden>•</span>
          )}
          <span className={styles.title} data-testid="mindmap-node">{node.title || t('untitled')}</span>
          <span className={styles.status}>{node.status}</span>
        </div>
        {kids.length > 0 && !isCollapsed && (
          <ul className={styles.children}>{kids.map(renderNode)}</ul>
        )}
      </li>
    );
  };

  return (
    <div data-testid="view-body-mindmap" className={styles.root}>
      <ul className={styles.tree}>{graph.rootIds.map(renderNode)}</ul>
    </div>
  );
}
```

- [ ] Add the `loadMindMapGraph` server action. In `apps/next-web/src/server/actions/views.ts` (the existing views actions file), add:

```ts
import { getMindMapGraph } from '../queries/views';
import type { MindMapGraph } from '@projectflow/types';

/** SSR-backed Mind Map graph for a saved view (used by MindMapView). */
export async function loadMindMapGraph(viewId: string): Promise<MindMapGraph> {
  await requireSession();
  try {
    return await getMindMapGraph(viewId);
  } catch {
    return { nodes: [], edges: [], rootIds: [] };
  }
}
```
(Use the file's existing `requireSession` import; if the views actions file lives elsewhere, add it there and keep the import path consistent.)

- [ ] Write `apps/next-web/src/components/views/mind-map-view.module.css`:

```css
.root { height: 100%; overflow: auto; padding: 12px; border-radius: 8px; border: 1px solid var(--border, #e5e7eb); background: var(--background, #fff); }
.empty { display: flex; height: 100%; align-items: center; justify-content: center; color: var(--text-2, #6b7280); font-size: 13px; }
.tree, .children { list-style: none; margin: 0; padding: 0; }
.children { margin-left: 18px; border-left: 1px dashed var(--border, #e5e7eb); padding-left: 10px; }
.node { padding: 2px 0; }
.nodeRow { display: flex; align-items: center; gap: 8px; padding: 3px 6px; border-radius: 6px; }
.nodeRow:hover { background: var(--muted, #f3f4f6); }
.toggle { border: none; background: none; cursor: pointer; width: 16px; font-size: 12px; line-height: 1; }
.leaf { width: 16px; text-align: center; color: var(--text-2, #9ca3af); }
.title { font-size: 13px; font-weight: 500; }
.status { margin-left: auto; font-size: 11px; color: var(--text-2, #6b7280); }
```

- [ ] Add the `MindMap` namespace to `en.json` and `id.json`:

en.json:
```json
"MindMap": {
  "loading": "Loading mind map…",
  "noNodes": "No tasks in this scope",
  "untitled": "Untitled task",
  "expand": "Expand",
  "collapse": "Collapse"
}
```
id.json:
```json
"MindMap": {
  "loading": "Memuat peta pikiran…",
  "noNodes": "Tidak ada tugas dalam cakupan ini",
  "untitled": "Tugas tanpa judul",
  "expand": "Perluas",
  "collapse": "Ciutkan"
}
```

- [ ] Run: `npm test --workspace apps/next-web -- messages` (i18n parity). Expected: PASS. Then `npm run build --workspace apps/next-web`. Expected: PASS.

- [ ] Commit:
```
git add apps/next-web/src/components/views/mind-map-view.tsx apps/next-web/src/components/views/mind-map-view.module.css apps/next-web/src/server/actions/views.ts apps/next-web/messages/en.json apps/next-web/messages/id.json
git commit -m "feat(9f): Mind Map view — collapsible subtree node graph + loadMindMapGraph action + i18n"
```

---

### Task 10: Chat view renderer + view-surface registration + i18n

**Files:**
- Create: `apps/next-web/src/components/views/chat-view.tsx`
- Modify: `apps/next-web/src/components/views/view-surface.tsx`
- Modify: `apps/next-web/messages/en.json` + `id.json`
- Note: read `apps/next-web/node_modules/next/dist/docs/` before writing web code.

Steps:

- [ ] Write `apps/next-web/src/components/views/chat-view.tsx` — a channel-style wrapper that reuses the existing `CommentSection` component (which already streams `comment:created` live, posts via the comment-create path, and renders mentions). The Chat view picks a target task: the view config can pin one (`config.chatTaskId`), else it uses the first task in the SSR page. The compose box is `CommentSection`'s built-in composer:

```tsx
'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { CommentSection } from '@/components/CommentSection';
import type { ViewTaskPageResult } from '@/server/queries/views';
import type { CustomField, SavedView } from '@projectflow/types';
import type { LiveScopeProp } from '@/components/views/view-surface';
import styles from './chat-view.module.css'; // optional; or reuse CommentSection styling

interface Props {
  taskPage: ViewTaskPageResult | null;
  activeView: SavedView;
  customFields: CustomField[];
  currentUserId?: string | null;
  workspaceId?: string;
  live: LiveScopeProp;
}

export function ChatView({ taskPage, activeView, currentUserId, workspaceId }: Props) {
  const t = useTranslations('ChatView');

  // Pinned task from config, else the first task in the active page.
  const targetTaskId = useMemo<string | null>(() => {
    const pinned = (activeView.config as any)?.chatTaskId as string | undefined;
    if (pinned) return pinned;
    return taskPage?.tasks?.[0]?.id ?? null;
  }, [activeView, taskPage]);

  if (!targetTaskId) {
    return <div className={styles.empty} data-testid="view-body-chat">{t('noChannel')}</div>;
  }

  const channelTitle = taskPage?.tasks?.find((x) => x.id === targetTaskId)?.title ?? t('channel');

  return (
    <div data-testid="view-body-chat" className={styles.root}>
      <header className={styles.header}># {channelTitle}</header>
      <div className={styles.stream}>
        <CommentSection
          taskId={targetTaskId}
          currentUserId={currentUserId ?? null}
          workspaceId={workspaceId ?? null}
        />
      </div>
    </div>
  );
}
```

Also create `apps/next-web/src/components/views/chat-view.module.css`:

```css
.root { display: flex; flex-direction: column; height: 100%; border-radius: 8px; border: 1px solid var(--border, #e5e7eb); background: var(--background, #fff); overflow: hidden; }
.header { padding: 10px 14px; border-bottom: 1px solid var(--border, #e5e7eb); font-weight: 600; font-size: 14px; }
.stream { flex: 1; min-height: 0; overflow: auto; padding: 8px 12px; }
.empty { display: flex; height: 100%; align-items: center; justify-content: center; color: var(--text-2, #6b7280); font-size: 13px; }
```

- [ ] Register `MapView`/`MindMapView`/`ChatView` in `view-surface.tsx`. Add the imports near the other view imports:

```tsx
import { MapView } from '@/components/views/map-view';
import { MindMapView } from '@/components/views/mind-map-view';
import { ChatView } from '@/components/views/chat-view';
```

Add the three cases to the `ViewBody` switch (before the `default`):

```tsx
    case 'map':
      return <MapView taskPage={taskPage} activeView={activeView} customFields={customFields} live={live} />;
    case 'mindmap':
      return <MindMapView taskPage={taskPage} activeView={activeView} customFields={customFields} live={live} />;
    case 'chat':
      return (
        <ChatView
          taskPage={taskPage}
          activeView={activeView}
          customFields={customFields}
          workspaceId={scopeType === 'SPACE' || scopeType === 'FOLDER' || scopeType === 'LIST' ? workspaceId : workspaceId}
          live={live}
        />
      );
```

> NOTE: `ViewBody` does not currently receive `workspaceId`/`currentUserId`. Thread `workspaceId` (already a prop on `ViewSurface`) and the current user id down into `ViewBody`'s prop list, then into the `ChatView` case. Confirm the `currentUserId` source in the views page (the SSR page that renders `ViewSurface` has the session) and pass it through `ViewSurface` → `ViewBody`. If `currentUserId` is not readily available, `CommentSection` accepts `null` (it just hides the edit/delete affordances) — pass `null` and leave a follow-up note.

- [ ] Add the `ChatView` namespace to `en.json` and `id.json`:

en.json:
```json
"ChatView": {
  "channel": "Channel",
  "noChannel": "No task to chat about in this view yet"
}
```
id.json:
```json
"ChatView": {
  "channel": "Saluran",
  "noChannel": "Belum ada tugas untuk diobrolkan di tampilan ini"
}
```

- [ ] Run: `npm test --workspace apps/next-web` (unit + `messages.unit` i18n parity). Expected: PASS — parity green. Then `npm run build --workspace apps/next-web`. Expected: PASS (Next build clean).

- [ ] Commit:
```
git add apps/next-web/src/components/views/chat-view.tsx apps/next-web/src/components/views/chat-view.module.css apps/next-web/src/components/views/view-surface.tsx apps/next-web/messages/en.json apps/next-web/messages/id.json
git commit -m "feat(9f): Chat view (reuses CommentSection) + view-surface registers map/mindmap/chat + i18n"
```

---

### Task 11: Playwright e2e (headline flow)

**Files:**
- Create: `apps/next-web/e2e/map-mindmap-chat.spec.ts`
- Note: e2e runs against local Docker `ProjectFlow_Test` only (use the project's existing e2e env/setup, same as the views/realtime specs).

Steps:

- [ ] Write the e2e spec covering the §9.5 acceptance flow — set a task's location and see the pin on Map; expand the Mind Map; post in Chat view. Follow the existing views/realtime spec harness (login helper, seeded space/list/task, the helper that creates a saved view of a given type — reuse what the views e2e already uses):

```ts
import { test, expect } from '@playwright/test';
import { loginAndSeedScope } from './helpers'; // existing helper used by the views specs

test.describe('Phase 9f — Map / Mind Map / Chat views', () => {
  test('location pins on Map, Mind Map expands, Chat posts a comment', async ({ page }) => {
    // Seed a SPACE with a 'location' custom field, a parent+child task, and a
    // location value on the parent; returns urls for each saved view type.
    const { spaceUrl, mapViewUrl, mindMapViewUrl, chatViewUrl } = await loginAndSeedScope(page, {
      locationField: true,
      tasks: [{ title: 'HQ', location: { lat: -6.2, lng: 106.8, label: 'Jakarta' }, children: ['Sub-A'] }],
    });

    // ── Map: the located task renders a pin; clicking it opens the task panel.
    await page.goto(mapViewUrl);
    await expect(page.getByTestId('view-body-map')).toBeVisible();
    const marker = page.locator('.leaflet-marker-icon').first();
    await expect(marker).toBeVisible();
    await marker.click();
    await expect(page.getByTestId('map-task-panel')).toBeVisible();
    await expect(page.getByTestId('map-task-panel')).toContainText('HQ');

    // ── Mind Map: the parent node renders with an expandable child.
    await page.goto(mindMapViewUrl);
    await expect(page.getByTestId('view-body-mindmap')).toBeVisible();
    await expect(page.getByTestId('mindmap-node').filter({ hasText: 'HQ' })).toBeVisible();
    // Collapse then re-expand the parent and confirm the child toggles.
    const toggle = page.getByTestId('mindmap-toggle').first();
    await toggle.click(); // collapse
    await expect(page.getByTestId('mindmap-node').filter({ hasText: 'Sub-A' })).toHaveCount(0);
    await toggle.click(); // expand
    await expect(page.getByTestId('mindmap-node').filter({ hasText: 'Sub-A' })).toBeVisible();

    // ── Chat: post a message; it appears in the stream (real comment).
    await page.goto(chatViewUrl);
    await expect(page.getByTestId('view-body-chat')).toBeVisible();
    const composer = page.getByPlaceholder(/add a comment|comment/i);
    await composer.fill('hello from the chat view');
    await page.getByRole('button', { name: /submit|send/i }).click();
    await expect(page.getByText('hello from the chat view')).toBeVisible();
  });
});
```

> NOTE: adapt `loginAndSeedScope` + the saved-view-url helpers to whatever the existing views e2e (`e2e/*views*.spec.ts`) already exposes; if there is no seeding helper that creates `location`-typed fields or typed saved views, extend the existing helper (do NOT fork a parallel one). The Chat composer selector should match `CommentSection`'s `addCommentPlaceholder` / submit button.

- [ ] Run: the project's e2e command for a single spec against `ProjectFlow_Test` (same invocation the views/realtime specs use, e.g. `npx playwright test e2e/map-mindmap-chat.spec.ts`). Expected: PASS (1 test) — pin visible + panel, mind-map expand/collapse, chat post appears.

- [ ] Commit:
```
git add apps/next-web/e2e/map-mindmap-chat.spec.ts
git commit -m "test(9f): e2e — Map pin+panel, Mind Map expand/collapse, Chat post"
```

---

### Task 12: Slice verification + DECISIONS.md

**Files:**
- Modify: `DECISIONS.md` (append a Phase 9f entry)

Steps:

- [ ] Run the full slice verification on local Docker `ProjectFlow_Test`:
  - `npm test --workspace apps/api` — Expected: PASS (existing suite + new `validators` location cases + `mindmap` unit tests).
  - `npm run test:integration --workspace apps/api` — Expected: PASS (existing + `map-mindmap-chat.integration.test.ts`).
  - `npm test --workspace apps/next-web` — Expected: PASS (unit + `messages.unit` parity).
  - `npm run build --workspace packages/types`, `npm run build --workspace apps/api`, and `npm run build --workspace apps/next-web` — Expected: all PASS.
  - The map-mindmap-chat e2e — Expected: PASS.

- [ ] Append a `DECISIONS.md` entry logging: the CHECK-widening-only `0050` migration (no new table — `location` value lives in `TaskCustomFieldValues.Value` JSON); the `{lat,lng,label}` shape + lat/lng range validation added to the Phase 2 validator; Map reusing the unchanged `viewTasks`/Phase 3 compiler path (located filter applied over decoded `customFieldValues`, NOT a new SQL path); Mind Map reusing `usp_Hierarchy_DescendantTasks` + a pure builder (re-rooting out-of-scope parents, BFS depth, cycle-safe); Chat delegating to the existing `commentService.create`/`list` (full mention/watcher/fan-out/realtime path, no second comment store); the new `leaflet`/`react-leaflet` dependency on free OpenStreetMap tiles (no paid key/geocoding — deferral §3); the `dynamic(ssr:false)` guard for leaflet; and any deviation found during implementation. DB-execution-policy note: all DB work ran ONLY against local Docker `ProjectFlow_Test`.

- [ ] Commit:
```
git add DECISIONS.md
git commit -m "docs(9f): DECISIONS entry — Map/MindMap/Chat views + location field type"
```

---

## Definition of Done

Per-slice DoD (spec §3) + BUILD_PLAN acceptance (spec §9.5):

- [ ] **§9.5 acceptance — Map plots located tasks:** the Map view plots every in-scope task carrying a valid `location` `{lat,lng,label}` value on OpenStreetMap tiles; clicking a pin opens the task panel (e2e-verified).
- [ ] **§9.5 acceptance — Mind Map renders the hierarchy:** the Mind Map view renders the `parent_task_id` subtree under the view scope as an expand/collapse node graph (reusing `usp_Hierarchy_DescendantTasks`; e2e-verified expand/collapse).
- [ ] **§9.5 acceptance — Chat streams + posts comments:** the Chat view renders a task's comment stream as a channel and posting creates a REAL comment via the existing comment-create path (integration + e2e verified).
- [ ] Migration `0050_location_field.sql` is idempotent, GO-batched, and **reversible** via `rollback/0050_location_field.down.sql` (apply→rollback→re-apply verified clean); the CHECK is widened (drop-then-recreate including `location`) over the exact `0035` lineage.
- [ ] `location` field-type validation (lat ∈ [-90,90], lng ∈ [-180,180], string label) added to the Phase 2 `validators.ts` + unit-tested; the pure mind-map graph builder unit-tested (single/multi-root, out-of-scope re-rooting, cycle-safety, empty).
- [ ] No new view introduces a second data path: Map reuses `viewTasks`/the Phase 3 compiler; Mind Map reuses the Phase 1 descendant query; Chat reuses Phase 4 `commentService`. All read gates fail-closed via `requireObjectLevel` (`VIEW`) and `requireWorkspacePermission` (`comment.create` to post).
- [ ] REST stays primary for comments (Chat posting also surfaces on the REST comment list); the GraphQL surface adds `mapTasks`/`mindMapGraph`/`chatChannel`/`postChatMessage` delegating to the **one shared** service per concern (`viewService`, `commentService`).
- [ ] `view-surface.tsx` registers `MapView`/`MindMapView`/`ChatView` for the `map`/`mindmap`/`chat` view tokens (the `ViewType` union + `CK_SavedViews_Type` CHECK already expanded by 9d).
- [ ] `@projectflow/types` updated (`CustomFieldType` gains `'location'`; `LocationValue`; `MindMapNode`/`MindMapEdge`/`MindMapGraph`).
- [ ] New dependency `leaflet`/`react-leaflet` (+ `@types/leaflet`) installed; free OpenStreetMap tiles only (no paid key/geocoding — spec deferral §3); leaflet loaded `dynamic(ssr:false)`.
- [ ] i18n: new `Map`/`MindMap`/`ChatView` keys in **en.json + id.json** (real Indonesian); `messages.unit` parity green.
- [ ] Unit + integration tests + ≥1 Playwright e2e for the headline flow — all green.
- [ ] All DB work (migration, SP deploy, integration, e2e) ran **ONLY against local Docker `ProjectFlow_Test`** — never the prod-pointing `apps/api/.env`.
- [ ] `DECISIONS.md` entry logs the mechanism choices + any deviations. **Stop for review/merge before the next slice / phase.**

---

## Self-Review

**Spec coverage (§9):**
- §9.1 model — `0050_location_field.sql` widens `CK_CustomFields_Type` to include `location` over the exact `0030`/`0035` lineage; value shape `{lat,lng,label}`; no other migration (Mind Map reads `parent_task_id`, Chat reads existing comments, both store only `config`). ✅ (Task 1)
- §9.2 backend — Map resolver = tasks in scope with a non-null `location` value via the Phase 3 compiler (`runView`) + a located filter (Task 5/6); `location` lat/lng validation in the Phase 2 validator (Task 3); Mind Map resolver = `parent_task_id` subtree reusing `usp_Hierarchy_DescendantTasks` (Task 5/6); Chat resolver = task comment stream as a channel, posting reuses `commentService.create` (Task 6). ✅
- §9.3 frontend — Map (OpenStreetMap tiles, pin→panel, Task 8); Mind Map (collapsible node graph, Task 9); Chat (channel-style comment stream + inline compose reusing `CommentSection`, Task 10). ✅
- §9.4 tests — unit: `location` validation + mind-map graph build (Tasks 3, 4); integration: Map returns only located tasks in scope + Chat post creates a real comment + Mind Map subtree (Task 7); e2e: location pin + mind-map expand + chat post (Task 11). ✅
- §9.5 acceptance — covered explicitly in DoD + the e2e. ✅
- Dependency on 9d (ViewType union + CHECK expanded) — stated in Prerequisite + §2.2; this slice only adds renderers + the `location` field type. ✅

**Placeholder scan:** Full SQL given for the CHECK widen + rollback (drop-then-recreate, both directions). Full `location` validator case + tests (both lat AND lng bounds explicitly checked — no "validate the other similarly"). Full `parseLocationValue` (API + web). Full pure `buildMindMapGraph` + tests. Full Map, Mind Map, Chat renderers and their CSS, registered in `view-surface.tsx`. Full GraphQL resolvers (`mapTasks`/`mindMapGraph`/`chatChannel`/`postChatMessage`) + object refs. Remaining inline NOTEs (the exact `viewTasks` userId/read-accessor helpers, the saved-view-create mutation result shape, the e2e seeding helper, the `currentUserId`/`workspaceId` threading into `ViewBody`) point at real call sites the implementer binds to — they are "use the real helper here" guidance, not omitted logic.

**Type/name consistency:** field-type token `location`; value shape `{lat,lng,label}` (`LocationValue`); view tokens `map`/`mindmap`/`chat` (matching the spec union + `view-surface` switch); migration number `0050`; CHECK constraint name `CK_CustomFields_Type`; descendant SP `usp_Hierarchy_DescendantTasks`; comment service `commentService.create`/`.list`; GraphQL ops `mapTasks`/`mindMapGraph`/`chatChannel`/`postChatMessage`; component names `MapView`/`MindMapView`/`ChatView`; i18n namespaces `Map`/`MindMap`/`ChatView`. All consistent across types, API, GraphQL, frontend, and tests.

**Known soft spots flagged for the implementer (not blockers):** (1) the exact `viewTasks` authz helpers in `views.schema.ts` (`userId` accessor + view read-accessor) must be reused verbatim — the resolver shapes here are the contract, bound to the real helpers; (2) `ViewBody` must be widened to thread `workspaceId`/`currentUserId` for `ChatView` (or pass `null`/leave a follow-up — `CommentSection` tolerates `null`); (3) the Phase 2 custom-field value route path (`PUT /tasks/:taskId/custom-fields/:fieldId`) used in the integration test must be confirmed against `customfield.routes.ts`/the task routes.
