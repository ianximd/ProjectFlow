# Decisions Log

## 2026-06-03 — Phase 1 Hierarchy

1. Dual API surface (REST primary + GraphQL mirror) — frontend is REST/SSR; @projectflow/types is hand-written. Both delegate to shared services.
2. Full per-object ACL implemented now via new ObjectPermissions table + usp_ObjectAccess_Resolve (existing RBAC has no object rows).
3. Idempotency-Key deferred (no existing mutation honors it; not a Phase 1 acceptance criterion).
4. Migration reversibility via committed rollback script infra/sql/migrations/rollback/0029_hierarchy.down.sql (runner is forward-only).
5. Projects table physically retained; relabeled "Space" only in API/UI via a single label constant.

### Execution-time extensions (logged during Task 1–20 implementation)

6. **Space visibility/depth PATCH** — `usp_Project_Update` extended with `@Visibility NVARCHAR(10)` and `@MaxSubtaskDepth INT` (both `NULL` = leave as-is, via `ISNULL`). The `PATCH /projects/:id` route + repository now accept `visibility` (`'PUBLIC'|'PRIVATE'`) and `maxSubtaskDepth` (number). This is how a Space is made PRIVATE (object-access test) and how the subtask-depth limit is set (depth test). Chosen over a separate `usp_Space_SetVisibility` to avoid a second project-update path.
7. **`usp_Task_Create.@ProjectId` made optional** — when `@ListId` is supplied the SP derives the Space (`ProjectId` bridge) and materializes `ListPath`; throws `51214` if neither is given. `CreateTaskInput.projectId` (REST schema + `@projectflow/types` + GraphQL input) is now optional accordingly. Lets tasks be created directly into a List without a redundant `projectId`.
8. **`usp_Task_Create.@ParentTaskId` surfaced to the API** — already an SP param; the create route/schema/repository now pass `parentTaskId` so the subtask-depth guard (`51230` → HTTP 422) is reachable end-to-end.
9. **DB verification deferred** — `apps/api/.env` points at the remote production DB and the integration test DB `ProjectFlow_Test` lives on that same gated instance, so live `db:migrate`/`db:deploy-sps` and the integration/e2e suites (Tasks 14/15/19/20) were authored but not executed this session (user-approved). Pure unit tests (Tasks 4/10/12/13) and `tsc --noEmit` were run and pass.

## Phase 3 (Views Engine) — dynamic query exception to SP-per-op

The dynamic task query (`ViewRepository.queryTasks`/`groupCounts`) builds parameterized SQL in a pure
TS compiler (`apps/api/src/modules/views/query/compiler.ts`) and runs it via the mssql parameterized
request, rather than a stored procedure. Rationale: the query shape is inherently dynamic (arbitrary
filter/sort over built-in + N user-defined custom fields), which fixed-param SPs cannot express.
Safety: field identifiers come only from an allow-list catalog (`builtin-fields.ts` + the scope's
custom fields); custom fields enter as parameterized FieldId GUIDs; operators from a fixed enum; every
value is a bound parameter; the tenant + scope + soft-delete predicate is always injected. SavedView
CRUD remains SP-per-op (`usp_View_*`).

### Deviations from the design spec (recorded per DoD)

- **Custom-field value extraction** (compiler): the spec's literal `CAST(JSON_VALUE(v.Value,'$') AS ...)`
  assumed object-wrapped JSON, but Phase-2 stores each value as the raw `JSON.stringify(value)` (a bare
  scalar like `8` or `true`, which `JSON_VALUE` rejects). The compiler instead uses the array-wrap form
  `JSON_VALUE('[' + v.Value + ']', '$[0]')` to normalize bare AND quoted scalars uniformly; `is_empty`/
  `is_not_empty` use the Phase-2 emptiness-sentinel pattern (`v.Value NOT IN ('','null','""','[]')`).
  This achieves the spec's intent (typed comparison over custom values) for the real storage format.
- **`type` built-in field** maps to the `Tasks.TaskTypeId` FK (the Phase-2 user-defined task type),
  not the legacy `Tasks.Type` string column.
- **`tags` built-in field** joins `TaskLabelLinks (LabelId)` (Phase-2 tags reuse the Labels feature),
  not a `TaskTags` table.
- **Join-backed `is_empty`/`is_not_empty`** (assignee/tags/watchers) use a bare-EXISTS descriptor
  (`existsBare`) rather than the brittle string-replace placeholder in the plan.
- **GraphQL `ViewTaskPage.tasks`**: `queryTasks` returns raw PascalCase Tasks columns; the GraphQL
  resolver maps them to the shared camelCase `Task` type via a `mapTaskRow` adapter.
- **EVERYTHING-scope authz**: EVERYTHING reads (`savedViews`/`viewTasks`/`previewViewTasks`) are guarded
  by workspace-membership (`requireWorkspacePermission('workspace.read')`) since there is no hierarchy
  node to gate on; EVERYTHING mutations are owner-only.
- **Bulk edit per-task authz**: `set_custom_field` and `move_to_list` enforce object-level EDIT on the
  task's List / destination List (matching the single-task REST routes); status/priority/assignees/
  delete use the workspace-membership gate (matching their REST `requirePermission` parity).

### v1 limitations (deferred, not blockers)

- Table custom-field (and reporter/assignee/tags/watchers) COLUMN VALUES render "—": the `viewTasks`
  projection (the camelCase `Task`) does not carry them. Filter/sort/group on those fields works
  server-side; only cell display is deferred (would require widening the viewTasks projection + Task type).
- Board retrofit: the engine board (`board-view-engine.tsx`) derives Kanban columns from the statuses
  present in the task set (not the node's effective workflow). The legacy `/board` (getTasks path) is
  UNCHANGED and remains the live board — engine-board cutover is gated on the parity checklist in
  `board-view-engine.tsx` and is future work.
- Calendar places only tasks within the currently fetched page (client-side month filter, no API change).
- The Playwright e2e (`e2e/views.spec.ts`) is written + discovered (3 scenarios) but its LIVE run
  requires the full local stack with a fully-migrated DB (the API .env points at prod; the e2e API must
  target a deployed `ProjectFlow_Test`). Spec compiles + lists; live run pending a deployed-DB e2e env.
- The EVERYTHING (workspace-wide) scope is backend-complete and tested (compiler/service/GraphQL with
  `requireWorkspacePermission` authz), but is NOT yet surfaced from the web UI — `page.tsx`/`getSavedViews`/
  `getViewTasks` don't pass `workspaceId` and there is no nav entry to an EVERYTHING views route. The
  backend gate fails closed (BAD_REQUEST without a workspaceId), so this is an un-surfaced entry point,
  not a regression. Wiring the EVERYTHING surface is deferred.
