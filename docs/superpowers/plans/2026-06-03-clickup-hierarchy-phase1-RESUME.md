# RESUME PROMPT — Execute ClickUp Hierarchy Phase 1

> Paste the block below into a fresh Claude Code session (clean cost counter) to continue.
> Everything needed is embedded so the session does NOT need to re-run codebase exploration.

---

Execute the implementation plan at `docs/superpowers/plans/2026-06-03-clickup-hierarchy-phase1.md` (ProjectFlow, Phase 1 nesting hierarchy). The plan is approved and complete — follow it task by task. Design source of truth: `docs/superpowers/specs/2026-06-03-clickup-hierarchy-design.md` §2.

## Current state (do NOT redo)
- Branch **`feat/hierarchy-phase1`** already exists and is checked out. Work on it.
- **Task 0 is DONE** (commit `c7364c1`): branch created, `DECISIONS.md` written with the 5 Phase-1 decisions. Start at **Task 1**.
- Tasks remaining: **1 through 20**.

## Locked decisions (already in DECISIONS.md — do not re-litigate)
1. **Dual API surface**: build REST routes (primary — the SSR frontend consumes these) **and** a Pothos GraphQL mirror in `graphql/schema.ts`; both delegate to one shared service per entity.
2. **Full per-object ACL now**: new `ObjectPermissions` table + `usp_ObjectAccess_Resolve` ancestry-walk resolver (existing RBAC has no object rows).
3. **Idempotency-Key deferred** (not a Phase 1 acceptance criterion).
4. **Reversible migration** = committed `infra/sql/migrations/rollback/0029_hierarchy.down.sql` (runner is forward-only).
5. `Projects` table kept; relabeled "Space" in API/UI only.

## Execution method
Use **superpowers:executing-plans** (or subagent-driven if you want, but that ran ~3× the cost). Recommended: execute inline with TDD, batching with checkpoints. Honor the repo's fact-forcing/gate hooks. Scope = Phase 1 ONLY (no custom fields / views / later phases). Stop for human review when Task 20 acceptance criteria pass.

## VERIFIED codebase conventions (already explored — trust these, don't re-discover)

**SQL / migrations**
- Migrations: `infra/sql/migrations/NNNN_*.sql`, next file is `0029_hierarchy.sql`. Idempotent guards: `IF NOT EXISTS (SELECT 1 FROM sys.tables/sys.columns/sys.indexes/sys.check_constraints …)`. Batches separated by `GO`.
- Runner: `scripts/db-migrate.ts`, run via `npm run db:migrate`. Records applied files by **SHA256 checksum** in `dbo.MigrationHistory`; never re-runs. **No down command** (hence committed rollback script). Confirm the exact `MigrationHistory` filename column before writing the rollback's final DELETE.
- Stored procs: separate files `infra/sql/procedures/usp_*.sql`, deployed via `npm run db:deploy-sps`. House style: `CREATE OR ALTER PROCEDURE`, `SET NOCOUNT ON;`, `BEGIN TRY/CATCH`, `THROW <code>, '<msg>', 1;`, return full row via `SELECT *`. Error code ranges: **50000s = domain**, **51000s = RBAC/security** (this plan uses 51200–51230 for hierarchy).
- IDs: `UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID()`. Timestamps `DATETIME2 ... DEFAULT SYSUTCDATETIME()`. Soft delete `DeletedAt DATETIME2 NULL` + `WHERE DeletedAt IS NULL`. Fractional order `Position FLOAT`.
- Existing tables: `Tasks` (has `ProjectId, WorkspaceId, ParentTaskId, Status, Position`, etc.), `Projects` (= Space; has `WorkflowId`, `DeletedAt`), `Workflows(Id,ProjectId,Name,IsDefault)`, `WorkflowStatuses(Id,WorkflowId,Name,Category,Color,Position)`, `WorkspaceMembers(WorkspaceId,UserId)`, `Workspaces(Id,OwnerId,…)`, RBAC `Permissions/Roles/RolePermissions/UserRoles`.

**Backend (apps/api/src)**
- Module shape: `modules/<entity>/{<entity>.repository.ts, .service.ts, .routes.ts}` (REST = Hono). GraphQL is central in `graphql/schema.ts`.
- DB helper: `execSpOne<T>(spName, params)` in `shared/lib/sqlClient.ts`; params are `{ name, type: sql.<Type>, value }[]`; returns recordset, use `rows[0]`.
- GraphQL: Pothos `builder.objectRef<Shape>('Name').implement({fields})`; context `graphql/context.ts` (`ctx.user.userId`, `ctx.pubsub`); `requireAuth(ctx)`; pubsub channels registered in `graphql/pubsub.ts` `PubSubChannels` type, publish `pubsub.publish('task:updated', {...})`.
- Auth/permissions: `shared/middleware/permissions.middleware.ts` → `requirePermission(slug, opts)` with `resolveWorkspace`. RBAC is a **flat workspace slug union** (`usp_UserPermissions_Get` → `roleService.getUserPermissionSlugs`). **No object-level ACL exists** — Tasks 7/10 build it new.
- No Idempotency-Key handling exists anywhere.
- Routes mounted in `apps/api/src/server.ts` (`app.route('/api/v1/...', xRoutes)`).

**Frontend (apps/next-web) — Next.js 16, READ `node_modules/next/dist/docs/` before web code (AGENTS.md mandate)**
- Consumes **REST** at `/api/v1/*`, not GraphQL. Server fetch helper `src/server/api.ts` (`serverFetch`, auth via access cookie, redirects on 401). Server queries `src/server/queries/*` wrapped in React `cache()`; normalizers in `src/server/queries/normalize.ts`. Server actions `src/server/actions/*` use `'use server'`, `requireSession()`, `revalidatePath()`, return `ActionResult` via `toActionError` (in `actions/error.ts`).
- Sidebar: `components/layouts/layout-1/components/sidebar-menu.tsx` (currently STATIC, driven by `config/layout-1.config.tsx` `MENU_SIDEBAR`). No tree yet. **dnd-kit IS installed** (`@dnd-kit/core|sortable|utilities`). `components/Board.tsx` shows dnd usage + a `midpoint(prev,next)` fractional helper to import. Task drawer: `components/TaskDrawer.tsx`. Page SSR pattern: `app/(app)/board/page.tsx` (async, `await params`, `requireSession`, server query → client view component).
- Types: hand-written `packages/types/index.ts` published as `@projectflow/types`. **No codegen, no i18n** wired.

**Tests**
- `apps/api/vitest.config.ts` has two projects: **unit** (`src/**/*.unit.test.ts`, mock repos with `vi.mock`) and **integration** (`src/**/*.integration.test.ts`, real MSSQL `ProjectFlow_Test`, sequential). Scripts: `npm run test:unit`, `npm run test:integration` (in `apps/api`).
- Integration setup: `src/__tests__/setup/globalSetup.ts` runs migrate + deploy-sps on the test DB; `fixtures/truncate.ts` `truncateAll()` deletes mutable tables child→parent **preserving Roles/Permissions/RolePermissions** (add `Folders`/`Lists`/`ObjectPermissions` to its order, Tasks-before-Lists); `fixtures/factories.ts` `createTestUser/createTestWorkspace/createTestProject/createTestTask`; `setup/testServer.ts` `request(path,{method,token,json})` + `json(res,status)` (in-process Hono).
- E2E: root `playwright.config.ts`, specs in `e2e/*.spec.ts`, `webServer` auto-starts API (`:3001`) + web (`:3000`). Pattern (see `e2e/smoke.spec.ts`): register/login via API to get token, create workspace/project via API, then drive UI with `page`. `e2e/global-setup.ts` flushes Redis `rl:*` keys.

## Known gotchas baked into the plan
- The plan's Task 15 requires a small `PATCH /projects/:id` extension to set `visibility` (and `maxSubtaskDepth`) — extend `usp_Project_Update` or add `usp_Space_SetVisibility`; log it in DECISIONS.md.
- Two integration assertions are intentionally left to make concrete during execution: the **status-override** test (Task 14, List-level workflow beats Space-level) and the **subtask-depth-exceed → 422** integration check (Tasks 13/20). Do not leave them as `expect(true)`.
- Confirm `midpoint` import path from `Board.tsx`; confirm `ActionResult`/`toActionError` shape from `actions/error.ts`; confirm the real `/tasks` POST body shape from `factories.ts`/`task.routes.ts` (may need reporter/status).

Begin at Task 1. Run tests as the plan specifies and paste real output before claiming any step passes.
