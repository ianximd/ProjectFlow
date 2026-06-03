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
