# Phase 5b — Relationships + Rollup Implementation Plan

> **For agentic workers:** execute via subagent-driven-development. Reference design spec
> `docs/superpowers/specs/2026-06-06-phase5-deps-relationships-recurring-templates-design.md` §4.
> Follow the patterns established in slice 5a (see `DECISIONS.md` §"Phase 5a Dependencies").

**Goal:** Two new custom-field types — `relationship` (link tasks; any-task or list-to-list) and `rollup`
(read-only aggregate of a field across related tasks) — extending the Phase-2 custom-field system.

**Architecture:** Relationship VALUES live in a new `TaskRelationships` link table (source of truth, not
`TaskCustomFieldValues`) so reverse lookups + rollup are clean SQL. `rollup` is computed in the service
(read-only, like `progress_auto`). Dual REST + GraphQL; hierarchy ACL; **workspace-validate the linked
task** (carry forward the 5a IDOR lesson).

**DB policy:** local Docker `ProjectFlow_Test` only (env per `e2e/README.md`); never the prod `.env`.

---

## Batches

### Batch 1 — Foundation (DB + types + validators + SPs + service + API)
**Migration `0035_relationships.sql`** (+ rollback):
- Create `TaskRelationships (Id PK, WorkspaceId, FieldId, FromTaskId, ToTaskId, CreatedAt, UQ(FieldId,FromTaskId,ToTaskId))` + indexes on `(FieldId,FromTaskId)` and `(FieldId,ToTaskId)` and `(WorkspaceId)`.
- Extend `CK_CustomFields_Type` to add `'relationship'` and `'rollup'` (drop + re-add the CHECK with the full list; read the current list from `0030_custom_fields.sql`).

**Types** (`packages/types/index.ts`): add `'relationship' | 'rollup'` to `CustomFieldType`; add to `CustomFieldConfig`:
`relationshipTargetType?: 'any'|'list'`, `relationshipTargetListId?: string`, `rollupRelationshipFieldId?: string`, `rollupSourceField?: FieldRef`, `rollupFunction?: 'sum'|'avg'|'count'|'min'|'max'|'first'|'concat'`. Add `RelationshipRef { taskId, title, status, issueKey? }`.

**Validators** (`apps/api/src/modules/customfields/validators.ts`):
- Generic VALUE-write path: `relationship` and `rollup` are **rejected** (managed separately / computed) — mirror the `progress_auto` `PROGRESS_AUTO_READONLY` reject.
- Add CONFIG validation (in the field create/update path — find where field config is validated; if none, add a `validateFieldConfig(type, config)`): `relationship` requires a valid `relationshipTargetType` (+ `relationshipTargetListId` when `'list'`); `rollup` requires `rollupRelationshipFieldId`, `rollupSourceField`, and a valid `rollupFunction`.

**SPs** (`infra/sql/procedures/`):
- `usp_TaskRelationship_Add(@FieldId,@FromTaskId,@ToTaskId,@WorkspaceId)` — validate the field is a `relationship` field in `@WorkspaceId`; validate BOTH tasks are in `@WorkspaceId` (THROW if not — IDOR guard); if the field config targets a specific list, the service validates list membership (or pass `@TargetListId` and validate here); idempotent insert; return the row.
- `usp_TaskRelationship_Remove(@FieldId,@FromTaskId,@ToTaskId)` — delete; return `@@ROWCOUNT`.
- `usp_TaskRelationship_ListForField(@FieldId,@FromTaskId)` — return ToTask refs `{ TaskId, Title, Status, IssueKey }` (join Tasks, `DeletedAt IS NULL`).
- (Rollup source values are read via existing task / custom-field-value reads in the service — no new SP unless a set-fetch helper is cleaner; if so add `usp_Task_GetCustomFieldValuesForTasks(@TaskIdsCsv,@FieldId)`.)

**Service/repository** (`apps/api/src/modules/relationships/`):
- `relationship.repository.ts` (add/remove/listForField).
- `relationship.service.ts`: `add(fieldId, fromTaskId, toTaskId, workspaceId)`, `remove(...)`, `list(fieldId, fromTaskId)`, and **`computeRollup(taskId, field)`** — resolve related task ids via the rollup's `relationshipFieldId`, fetch the `sourceField` value per related task (builtin column from a task read, or `TaskCustomFieldValues` for custom), aggregate by `rollupFunction` (pure helper `aggregateRollup(fn, values)` — unit-tested: sum/avg/count/min/max/first/concat; empty set → null/0 sensibly). **Workspace-validate `toTaskId`** in `add` (carry forward 5a IDOR fix).
- Rollup integrates into the task custom-field-values READ path: where a task's resolved custom field values are produced, compute `rollup`-type fields via `computeRollup`.

**API** (REST + GraphQL):
- REST (on `taskRoutes`, mirroring 5a deps): `GET /tasks/:taskId/relationships/:fieldId` (VIEW); `POST /tasks/:taskId/relationships/:fieldId` body `{ toTaskId }` (EDIT, `task.update`, workspace-validate toTaskId → 404 on mismatch); `DELETE /tasks/:taskId/relationships/:fieldId/:toTaskId` (EDIT).
- GraphQL mirror: `taskRelationships(taskId, fieldId)`, `addTaskRelationship`, `removeTaskRelationship` (VIEW / `task.update`, same workspace guard). Rollup values surface through the existing task custom-field-value GraphQL/REST read.
- Field-manager create/update path accepts the two new types + their config (validated).

**Verify Batch 1 (local Docker):** deploy migration + SPs (0 failed); `apps/api` tsc clean; `vitest --project unit` green (+ new aggregateRollup tests); `vitest --project integration` green.

### Batch 2 — Frontend
- Field-manager config UI: `relationship` (target any/list + list picker when 'list'); `rollup` (pick a relationship field on the scope + source field + function).
- Task panel: relationship picker (link/unlink tasks via the 5a search pattern); read-only rollup display.
- Table/views: relationship cell (linked task chips) + read-only rollup cell. (Filter/sort/group on these two field types is DEFERRED — display only — per spec §4.8.)
- i18n `Relationships`/`Rollup` keys in en + id (parity test green).
- Verify: web `vitest` (104+ green incl. parity), tsc/build clean.

### Batch 3 — Tests
- Integration: set a relationship across two lists (list-to-list); compute a rollup pulling a numeric field (e.g. story points) from related tasks (sum/avg/count); `targetType='list'` membership enforcement; **cross-workspace link rejected (404)**; rollup read-only via generic value path.
- e2e `relationships.spec.ts`: create two tasks in different lists, link them via a relationship field, add a rollup field, verify the rollup column shows the aggregated value.
- Verify all green (local Docker).

### Slice close
Consolidated review (read-only) → fix findings → full verify (API unit+integration, web unit+parity, build, e2e) → `DECISIONS.md` §5b + memory update → ff-merge to `main` locally.

---

## Acceptance (spec §4.7)
- [ ] List-to-list relationship + rollup shows a value pulled from the related task.

## Carry-forward guards (from 5a review)
- Workspace-validate every linked `toTaskId` (REST + GraphQL) — no cross-workspace links.
- Do NOT re-export `import type` bindings from `'use server'` action files (Next 16/Turbopack runtime crash).
- Object-level GET 404 when `ListId IS NULL` is a known pre-existing gap (board-created tasks) — not introduced here.
