# Phase 10a — Apps / Feature Toggles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the **modularity layer** — a workspace/space/folder/list can turn optional features on or off. An app is a **key** (`time_tracking`, `multiple_assignees`, …) declared in a **default-on registry**; an `AppsEnabled` table stores only **overrides**; resolution walks the hierarchy ancestry (workspace → space → folder → list, the same ancestry walk `usp_ObjectAccess_Resolve` performs) and the **most-specific override wins**, falling back to the registry default. A new **`requireApp(appKey)`** middleware (REST + GraphQL equivalent) **composes with** the existing `requirePermission` — an app being off means *feature-absent* (404), orthogonal to a 403 permission denial — and is retrofitted onto the optional Phase 2/5/8 features (Time Tracking, Multiple Assignees, Sprint Points, Nested Subtasks, Dependency Warning + Reschedule, Custom Task IDs, Email). The frontend resolves the effective app set per scope and an **App Center** toggle grid writes overrides; disabled features hide/show live.

**Architecture:** `AppsEnabled(ScopeType, ScopeId, AppKey, Enabled)` stores overrides only, `UNIQUE(WorkspaceId, ScopeType, ScopeId, AppKey)`. The registry (`apps/api/src/modules/apps/app-registry.ts`) is the default + which-scopes-may-override source of truth. `usp_AppsEnabled_ListForScope` returns the ancestor **override chain** for a scope node (the workspace row + Space + ancestor Folders + the List, ordered by depth), reusing the `Path LIKE` ancestry scan from `usp_ObjectAccess_Resolve`. The pure resolver `resolveAppEnabled(registry, appKey, chain)` picks the deepest override or the registry default — unit-tested in isolation. `app.service.isEnabled(appKey, scopeNode)` / `resolveAll(scopeNode)` wrap it with **per-request caching** keyed on the context (mirroring `loadPermissions`'s context cache). `requireApp(appKey)` resolves the scope node for a route (a task → its List, or an explicit param), calls `isEnabled`, and on `false` returns a **404 feature-absent** envelope (`APP_DISABLED`) — composing in front of `requirePermission`. REST routes `GET /apps`, `GET /apps/:scope`, `PATCH /apps/:scope/:key` + a GraphQL mirror (`appToggles` query, `setAppToggle` mutation), both delegating to the one shared `AppService` and guarded by a new `app.manage` slug + `FULL` on the scope object. Toggle writes publish a `task:event`-style refresh so feature surfaces appear/disappear live.

**Tech Stack:** SQL Server stored procedures (`CREATE OR ALTER`, `SET NOCOUNT ON`, TRY/CATCH/TRANSACTION, idempotent `IF NOT EXISTS`/`COL_LENGTH` migrations + GO batches + matching `.down.sql`); Hono REST + `@hono/zod-validator`; graphql-yoga + Pothos (`@pothos/core`); `mssql` via `execSp`/`execSpOne`; vitest (`--project unit` / `--project integration`); Next.js App Router (SSR) + `next-intl` (en + id parity); Playwright e2e. DB work runs ONLY against local Docker `ProjectFlow_Test` — never the prod-pointing `apps/api/.env`.

**Prerequisite:** Phases 1–9 merged. Builds directly on the existing **ACL ancestry walk** (`infra/sql/procedures/usp_ObjectAccess_Resolve.sql` + `infra/sql/migrations/0029_hierarchy.sql` — Space `Path`, Folders/Lists `Path` materialized columns, `Path LIKE` ancestry scan) and the REST **`requirePermission`** middleware (`apps/api/src/shared/middleware/permissions.middleware.ts`) + GraphQL `requireWorkspacePermission`/`requireObjectLevel` (`apps/api/src/graphql/authz.ts`). On-disk migrations are currently `0037`; this slice assumes Phases 6–9 land `0038–0050` first and uses **`0051`**. (Note: the Phase 8 time-tracking worklog module already exists on-disk as the gate target; if its timer/estimate routes from `2026-06-07-phase8a-time-tracking.md` are not yet merged when this slice runs, retrofit `requireApp('time_tracking')` onto whatever worklog routes exist and note the rest inline.)

---

## File Structure

**Migration**
- `infra/sql/migrations/0051_apps_enabled.sql` — **Create.** Idempotent, GO-batched: create `AppsEnabled(Id, WorkspaceId, ScopeType, ScopeId, AppKey, Enabled, UpdatedBy, CreatedAt, UpdatedAt)` with `UNIQUE(WorkspaceId, ScopeType, ScopeId, AppKey)`; seed the `app.manage` permission slug into `Permissions` + grant it to `workspace-owner`/`workspace-admin`.
- `infra/sql/migrations/rollback/0051_apps_enabled.down.sql` — **Create.** Reverse: drop the `app.manage` `RolePermissions`/`Permissions` rows, drop `AppsEnabled`.

**Stored procedures** (`infra/sql/procedures/`)
- `usp_AppsEnabled_Set.sql` — **Create.** Upsert (MERGE) one override row for `(WorkspaceId, ScopeType, ScopeId, AppKey)`; `@Enabled = NULL` deletes the override (revert to inherited/default). Returns the affected row.
- `usp_AppsEnabled_ListForScope.sql` — **Create.** Given a scope node, resolve its ancestry (workspace + Space + ancestor Folders via `Path LIKE` + the List) and return the **override chain** — every `AppsEnabled` row on any ancestor, with a `Depth` so the most-specific wins. Also a flat `GET /apps/:scope` "rows for exactly this scope" mode.

**API** (`apps/api/src/`)
- `modules/apps/app-registry.ts` — **Create.** The default-on registry: every `AppKey` with `label`, `defaultEnabled`, and `overridableScopes`. Plus the pure resolver `resolveAppEnabled` + `resolveAllApps` (most-specific-wins over an override chain).
- `modules/apps/app.repository.ts` — **Create.** `setOverride`/`listChainForScope`/`listForScope` via `execSpOne`/`execSp`.
- `modules/apps/app.service.ts` — **Create.** `isEnabled(appKey, scopeNode)` (per-request cached), `resolveAll(scopeNode)`, `setToggle(...)`; resolves a scope node from a task (`scopeNodeForTask`).
- `modules/apps/app.routes.ts` — **Create.** `GET /apps`, `GET /apps/:scopeType/:scopeId`, `PATCH /apps/:scopeType/:scopeId/:key` (guarded by `app.manage` + `FULL` on the object).
- `shared/middleware/requireApp.middleware.ts` — **Create.** `requireApp(appKey, resolveScope?)` REST middleware (404 feature-absent, composes with `requirePermission`) + a per-context cache mirroring `loadPermissions`.
- `graphql/apps.schema.ts` — **Create.** `registerAppsGraphql()`: `AppToggle` type + `appToggles(scopeType, scopeId)` query + `setAppToggle` mutation + the GraphQL `requireApp` equivalent (`assertAppEnabled`).
- `graphql/schema.ts` — **Modify.** Import + call `registerAppsGraphql()` near the other `register*Graphql()` calls.
- `server.ts` — **Modify.** Import `appRoutes`, add `app.use('/apps/*', authMiddleware)` + `app.route('/apps', appRoutes)`.

**Retrofits** (apply `requireApp` to existing optional features)
- `modules/worklogs/worklog.routes.ts` — **Modify.** `requireApp('time_tracking')` on every worklog/timer/estimate route (composes with the existing `requirePermission`).
- `modules/tasks/task.routes.ts` — **Modify.** `requireApp('multiple_assignees')` on `PUT /:id/assignees`; `requireApp('dependency_warning')` on the dependency routes + the transition path that raises `DependencyWarningError`; `requireApp('reschedule_dependencies')` on the reschedule path; `requireApp('nested_subtasks')` on the `POST /` create when `parentTaskId` is present.
- `graphql/worklog.schema.ts` — **Modify (if present).** `assertAppEnabled('time_tracking', …)` on the worklog mirror resolvers; **note inline** if the Phase 8a GraphQL mirror has not landed.
- Inline notes for features not yet on-disk: **Sprint Points** (Phase 8c), **Custom Task IDs**, **Email** — each documented as "apply `requireApp('<key>')` when this feature lands," with the exact gate shown.

**Types** (`packages/types/`)
- `index.ts` — **Modify.** Add `AppKey`, `AppScopeType`, `AppToggle`, `AppRegistryEntry`, `ResolvedApp`.

**Frontend** (`apps/next-web/src/`)
- `server/actions/apps.ts` — **Create.** `loadAppToggles(scopeType, scopeId)` + `setAppToggle(scopeType, scopeId, appKey, enabled)` server actions (mirror `hierarchy.ts`'s `serverFetch` + `ActionResult` shape).
- `components/AppCenter.tsx` — **Create.** The per-scope toggle grid (label, description, on/off, inheritance indicator).
- `components/AppCenter.module.css` — **Create.** Styles for the grid.
- `lib/appGate.ts` — **Create.** A tiny client helper + the resolved-app context so feature surfaces (timer widget, sprint-points column, dependency warnings) hide when an app is off.
- `app/(app)/workspaces/[id]/settings/app-center-section.tsx` — **Create.** Mounts `<AppCenter scopeType="workspace" scopeId={workspaceId} />` in workspace settings.
- `messages/en.json` — **Modify.** New `AppCenter` namespace + the per-app labels/descriptions.
- `messages/id.json` — **Modify.** Same keys, real Indonesian.

**Tests**
- `apps/api/src/modules/apps/__tests__/resolve.unit.test.ts` — **Create.** Pure most-specific-wins resolution (default → workspace → space → folder → list) + registry defaults + `resolveAllApps`.
- `apps/api/src/modules/apps/__tests__/apps.integration.test.ts` — **Create.** Disabling Time Tracking at a Space makes the worklog/timer endpoints feature-absent beneath it while a sibling Space keeps them; re-enabling restores; `app.manage`/`FULL` gating fail-closed.
- `apps/next-web/e2e/app-toggles.spec.ts` — **Create.** Toggle Time Tracking off for a Space → timers disappear there; on → reappear.

---

## Tasks

### Task 1: Migration + rollback (`0051_apps_enabled.sql`)

**Files:**
- Create: `infra/sql/migrations/0051_apps_enabled.sql`
- Create: `infra/sql/migrations/rollback/0051_apps_enabled.down.sql`
- Test: manual deploy against local Docker `ProjectFlow_Test` (migrations have no unit harness; verified via the integration suite in Task 7).

Steps:

- [ ] Write the migration. Idempotent (`sys.tables` / `sys.columns` / catalog guards), GO-batched, matching the `0029`/`0033` style. `ScopeId` is **NULL for the workspace-level override** (the workspace itself is the root scope; `ScopeType='workspace'` rows carry `ScopeId = NULL`). Seeds the `app.manage` slug and grants it to the two admin system roles:

```sql
-- =============================================================================
-- Migration 0051: Apps / feature toggles (Phase 10a)
-- AppsEnabled stores ONLY overrides; the default-on registry of app keys lives
-- in code (apps/api/src/modules/apps/app-registry.ts). Resolution walks the
-- hierarchy ancestry (workspace -> space -> folder -> list) and the most-specific
-- override wins, falling back to the registry default. Mirrors the ObjectPermissions
-- ancestry model from 0029.
-- Also seeds the app.manage RBAC slug (grants the App Center write path).
-- Idempotent (catalog guards), GO-batched.
-- Rollback in rollback/0051_apps_enabled.down.sql.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AppsEnabled')
BEGIN
    CREATE TABLE dbo.AppsEnabled (
        Id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Workspaces(Id),
        ScopeType   NVARCHAR(12)     NOT NULL,            -- 'workspace'|'space'|'folder'|'list'
        ScopeId     UNIQUEIDENTIFIER NULL,                -- NULL when ScopeType='workspace'
        AppKey      NVARCHAR(40)     NOT NULL,
        Enabled     BIT              NOT NULL,
        UpdatedBy   UNIQUEIDENTIFIER NULL REFERENCES dbo.Users(Id),
        CreatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_AppsEnabled_ScopeType CHECK (ScopeType IN ('workspace','space','folder','list')),
        -- One override per (scope, app). ScopeId NULL (workspace) participates as a
        -- distinct slot; SQL Server treats NULL as a single value in a UNIQUE index,
        -- so at most one workspace-level override per (WorkspaceId, AppKey) AppKey.
        CONSTRAINT UQ_AppsEnabled UNIQUE (WorkspaceId, ScopeType, ScopeId, AppKey)
    );
    CREATE NONCLUSTERED INDEX IX_AppsEnabled_Scope ON dbo.AppsEnabled (ScopeType, ScopeId);
    CREATE NONCLUSTERED INDEX IX_AppsEnabled_Ws    ON dbo.AppsEnabled (WorkspaceId, AppKey);
END
GO

-- ── RBAC: app.manage slug (WORKSPACE scope) ─────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE Slug = 'app.manage')
BEGIN
    INSERT INTO dbo.Permissions (Id, Resource, Action, Slug, Scope, Description)
    VALUES (NEWID(), 'app', 'manage', 'app.manage', 'WORKSPACE',
            'Enable or disable feature apps for a workspace/space/folder/list');
END
GO

-- Grant app.manage to workspace-owner and workspace-admin system roles.
INSERT INTO dbo.RolePermissions (RoleId, PermissionId)
SELECT r.Id, p.Id
FROM   dbo.Roles r
CROSS JOIN dbo.Permissions p
WHERE  p.Slug = 'app.manage'
  AND  r.IsSystem = 1
  AND  r.Slug IN ('workspace-owner', 'workspace-admin')
  AND  NOT EXISTS (SELECT 1 FROM dbo.RolePermissions rp WHERE rp.RoleId = r.Id AND rp.PermissionId = p.Id);
GO
```

- [ ] Write the rollback `rollback/0051_apps_enabled.down.sql` (reverse order; RolePermissions → Permissions → table):

```sql
-- Rollback 0051: Apps / feature toggles.
-- Drops the app.manage grants + slug, then the AppsEnabled table.

DELETE rp
FROM   dbo.RolePermissions rp
JOIN   dbo.Permissions p ON p.Id = rp.PermissionId
WHERE  p.Slug = 'app.manage';
GO

DELETE FROM dbo.Permissions WHERE Slug = 'app.manage';
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AppsEnabled') DROP TABLE dbo.AppsEnabled;
GO
```

- [ ] Run against local Docker `ProjectFlow_Test` only (explicit local DB env, never `apps/api/.env`). Apply `0051_apps_enabled.sql`, then immediately the `.down.sql`, then re-apply `0051` to prove idempotency + reversibility. Expected: all three runs succeed with no errors; the second `0051` apply is a clean no-op (guards skip the table; the `app.manage` insert + the `NOT EXISTS`-guarded grant are no-ops).

- [ ] Commit:
```
git add infra/sql/migrations/0051_apps_enabled.sql infra/sql/migrations/rollback/0051_apps_enabled.down.sql
git commit -m "feat(10a): apps-enabled migration — AppsEnabled overrides table + app.manage slug"
```

---

### Task 2: Toggle SPs (`AppsEnabled_Set`, `AppsEnabled_ListForScope`)

**Files:**
- Create: `infra/sql/procedures/usp_AppsEnabled_Set.sql`
- Create: `infra/sql/procedures/usp_AppsEnabled_ListForScope.sql`
- Test: covered by `apps.integration.test.ts` (Task 7); deploy via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`.

Steps:

- [ ] Write `usp_AppsEnabled_Set.sql` — upsert one override; `@Enabled = NULL` deletes the override (revert to inherited/default). The `@ScopeId` is NULL for `ScopeType='workspace'`. Returns the row after the write (or no rows after a delete):

```sql
CREATE OR ALTER PROCEDURE dbo.usp_AppsEnabled_Set
  @WorkspaceId UNIQUEIDENTIFIER,
  @ScopeType   NVARCHAR(12),
  @ScopeId     UNIQUEIDENTIFIER = NULL,
  @AppKey      NVARCHAR(40),
  @Enabled     BIT              = NULL,   -- NULL = clear the override (inherit)
  @UpdatedBy   UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON;

  BEGIN TRY
    BEGIN TRANSACTION;

    IF @Enabled IS NULL
    BEGIN
      DELETE FROM dbo.AppsEnabled
      WHERE WorkspaceId = @WorkspaceId AND ScopeType = @ScopeType
        AND ((@ScopeId IS NULL AND ScopeId IS NULL) OR ScopeId = @ScopeId)
        AND AppKey = @AppKey;
    END
    ELSE
    BEGIN
      MERGE dbo.AppsEnabled AS tgt
      USING (SELECT @WorkspaceId AS WorkspaceId, @ScopeType AS ScopeType,
                    @ScopeId AS ScopeId, @AppKey AS AppKey) AS src
        ON  tgt.WorkspaceId = src.WorkspaceId
        AND tgt.ScopeType   = src.ScopeType
        AND ((src.ScopeId IS NULL AND tgt.ScopeId IS NULL) OR tgt.ScopeId = src.ScopeId)
        AND tgt.AppKey      = src.AppKey
      WHEN MATCHED THEN
        UPDATE SET Enabled = @Enabled, UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (Id, WorkspaceId, ScopeType, ScopeId, AppKey, Enabled, UpdatedBy)
        VALUES (NEWID(), @WorkspaceId, @ScopeType, @ScopeId, @AppKey, @Enabled, @UpdatedBy);
    END

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;

  SELECT ae.Id, ae.WorkspaceId, ae.ScopeType, ae.ScopeId, ae.AppKey, ae.Enabled,
         ae.UpdatedBy, ae.CreatedAt, ae.UpdatedAt
  FROM   dbo.AppsEnabled ae
  WHERE  ae.WorkspaceId = @WorkspaceId AND ae.ScopeType = @ScopeType
    AND  ((@ScopeId IS NULL AND ae.ScopeId IS NULL) OR ae.ScopeId = @ScopeId)
    AND  ae.AppKey = @AppKey;
END;
GO
```

- [ ] Write `usp_AppsEnabled_ListForScope.sql` — resolve the scope node's ancestry and return the **override chain**: every `AppsEnabled` row on any ancestor (workspace row + Space + ancestor Folders + the List), each tagged with a `Depth` (0 = workspace, then Space, then folder depth via `LEN(Path)`, then 9999 = the List) so the service picks the deepest per `AppKey`. Reuses the exact `Path LIKE` ancestor scan from `usp_ObjectAccess_Resolve`. A `NULL @ScopeId` (workspace scope) returns just the workspace-level overrides:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_AppsEnabled_ListForScope
  @WorkspaceId UNIQUEIDENTIFIER,
  @ScopeType   NVARCHAR(12),            -- 'workspace'|'space'|'folder'|'list'
  @ScopeId     UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @SpaceId UNIQUEIDENTIFIER, @Path NVARCHAR(900);

  IF @ScopeType = 'space'
    SELECT @SpaceId = Id, @Path = '/' + CONVERT(NVARCHAR(36), Id) + '/'
    FROM dbo.Projects WHERE Id = @ScopeId AND Status <> 'DELETED';
  ELSE IF @ScopeType = 'folder'
    SELECT @SpaceId = SpaceId, @Path = Path FROM dbo.Folders WHERE Id = @ScopeId AND DeletedAt IS NULL;
  ELSE IF @ScopeType = 'list'
    SELECT @SpaceId = SpaceId, @Path = Path FROM dbo.Lists WHERE Id = @ScopeId AND DeletedAt IS NULL;
  -- @ScopeType = 'workspace' leaves @SpaceId/@Path NULL → only the workspace row applies.

  -- Ancestry: the workspace (depth 0), the Space, ancestor folders (Path is a
  -- prefix of @Path), and the scope object itself.
  DECLARE @Ancestry TABLE (ScopeType NVARCHAR(12), ScopeId UNIQUEIDENTIFIER, Depth INT);
  INSERT INTO @Ancestry VALUES ('workspace', NULL, 0);
  IF @SpaceId IS NOT NULL
    INSERT INTO @Ancestry VALUES ('space', @SpaceId, 1);
  IF @Path IS NOT NULL
    INSERT INTO @Ancestry
      SELECT 'folder', f.Id, LEN(f.Path)
      FROM dbo.Folders f
      WHERE f.SpaceId = @SpaceId AND f.DeletedAt IS NULL AND @Path LIKE f.Path + '%';
  IF @ScopeType = 'list'
    INSERT INTO @Ancestry VALUES ('list', @ScopeId, 9999);

  SELECT ae.AppKey, ae.Enabled, a.ScopeType, a.ScopeId, a.Depth
  FROM   dbo.AppsEnabled ae
  JOIN   @Ancestry a
         ON a.ScopeType = ae.ScopeType
        AND ((a.ScopeId IS NULL AND ae.ScopeId IS NULL) OR a.ScopeId = ae.ScopeId)
  WHERE  ae.WorkspaceId = @WorkspaceId
  ORDER BY ae.AppKey, a.Depth DESC;
END;
GO
```

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test` (local DB env only). Expected: both procedures created with no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_AppsEnabled_Set.sql infra/sql/procedures/usp_AppsEnabled_ListForScope.sql
git commit -m "feat(10a): toggle SPs — AppsEnabled_Set (MERGE/clear) + ListForScope (ancestry override chain)"
```

---

### Task 3: App-key registry + pure resolver + unit tests

**Files:**
- Modify: `packages/types/index.ts` (add the app-toggle type block)
- Create: `apps/api/src/modules/apps/app-registry.ts`
- Create: `apps/api/src/modules/apps/__tests__/resolve.unit.test.ts`

Steps:

- [ ] Add the shared types to `packages/types/index.ts` (after the `ObjectPermissionLevel`/`HierarchyNodeType` block, ~line 80):

```ts
// ── Apps / feature toggles (Phase 10a) ────────────────────────────────────────

/** Scope at which a feature app may be toggled. 'workspace' is the root
 *  (ScopeId is null); the others reuse the hierarchy node identity. */
export type AppScopeType = 'workspace' | 'space' | 'folder' | 'list';

/** The full set of toggleable feature keys (the registry is the source of truth
 *  for defaults; this union is its key space). */
export type AppKey =
  | 'time_tracking'
  | 'multiple_assignees'
  | 'sprint_points'
  | 'nested_subtasks'
  | 'dependency_warning'
  | 'reschedule_dependencies'
  | 'custom_task_ids'
  | 'email';

/** One declared app in the default-on registry. */
export interface AppRegistryEntry {
  key:                AppKey;
  label:              string;          // i18n key suffix under AppCenter.apps
  defaultEnabled:     boolean;
  /** Which scope types may override this app (App Center renders only these). */
  overridableScopes:  AppScopeType[];
}

/** A stored override row (only overrides are persisted; defaults live in code). */
export interface AppToggle {
  appKey:    AppKey;
  scopeType: AppScopeType;
  scopeId:   string | null;            // null at workspace scope
  enabled:   boolean;
}

/** The resolved effective state of one app for a scope (default or override). */
export interface ResolvedApp {
  key:      AppKey;
  enabled:  boolean;
  /** True when the value came from an explicit override (vs. the registry default). */
  overridden: boolean;
  /** The scope the winning override lives at (null = inherited default). */
  source:   AppScopeType | null;
}
```

- [ ] Write the failing unit test first. `resolve.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { APP_REGISTRY, resolveAppEnabled, resolveAllApps, type OverrideRow } from '../app-registry.js';

// Depth order produced by usp_AppsEnabled_ListForScope: workspace=0, space=1,
// folders by LEN(Path), list=9999. Higher Depth = more specific = wins.
const ws    = (key: string, enabled: boolean): OverrideRow => ({ appKey: key as any, enabled, scopeType: 'workspace', scopeId: null, depth: 0 });
const space = (key: string, enabled: boolean): OverrideRow => ({ appKey: key as any, enabled, scopeType: 'space', scopeId: 's', depth: 1 });
const list  = (key: string, enabled: boolean): OverrideRow => ({ appKey: key as any, enabled, scopeType: 'list', scopeId: 'l', depth: 9999 });

describe('resolveAppEnabled — most-specific-wins', () => {
  it('falls back to the registry default with no overrides', () => {
    // time_tracking defaults ON in the registry.
    expect(resolveAppEnabled('time_tracking', []).enabled).toBe(true);
    expect(resolveAppEnabled('time_tracking', []).overridden).toBe(false);
    expect(resolveAppEnabled('time_tracking', []).source).toBeNull();
  });

  it('a workspace override beats the registry default', () => {
    const r = resolveAppEnabled('time_tracking', [ws('time_tracking', false)]);
    expect(r.enabled).toBe(false);
    expect(r.overridden).toBe(true);
    expect(r.source).toBe('workspace');
  });

  it('a space override beats a workspace override', () => {
    const r = resolveAppEnabled('time_tracking', [ws('time_tracking', true), space('time_tracking', false)]);
    expect(r.enabled).toBe(false);
    expect(r.source).toBe('space');
  });

  it('a list override beats space + workspace (deepest wins)', () => {
    const r = resolveAppEnabled('time_tracking', [
      ws('time_tracking', false), space('time_tracking', false), list('time_tracking', true),
    ]);
    expect(r.enabled).toBe(true);
    expect(r.source).toBe('list');
  });

  it('ignores overrides for other app keys', () => {
    const r = resolveAppEnabled('time_tracking', [space('multiple_assignees', false)]);
    expect(r.enabled).toBe(true);           // unaffected → registry default
    expect(r.overridden).toBe(false);
  });

  it('an unknown app key is treated as disabled (fail-closed)', () => {
    expect(resolveAppEnabled('not_a_real_app' as any, []).enabled).toBe(false);
  });
});

describe('resolveAllApps', () => {
  it('returns every registry app with its resolved state', () => {
    const all = resolveAllApps([space('time_tracking', false)]);
    expect(all).toHaveLength(APP_REGISTRY.length);
    const tt = all.find((a) => a.key === 'time_tracking')!;
    expect(tt.enabled).toBe(false);
    expect(tt.source).toBe('space');
    // a non-overridden app keeps its default
    const na = all.find((a) => a.key === 'multiple_assignees')!;
    expect(na.overridden).toBe(false);
  });
});
```

- [ ] Run: `npm test --workspace apps/api -- resolve.unit` (i.e. `vitest run --project unit` filtered). Expected: FAIL — `Cannot find module '../app-registry.js'`.

- [ ] Write `apps/api/src/modules/apps/app-registry.ts` — the registry (every spec app key with its default + override scopes) + the pure resolver:

```ts
import type { AppKey, AppRegistryEntry, AppScopeType, ResolvedApp } from '@projectflow/types';

/**
 * The default-on registry. AppsEnabled stores ONLY overrides; this is the
 * source of truth for defaults + which scopes may override each app. Every app
 * here is gated by requireApp(key) somewhere in the API.
 *
 * `label` is the i18n key suffix under the AppCenter.apps namespace.
 */
export const APP_REGISTRY: readonly AppRegistryEntry[] = [
  { key: 'time_tracking',           label: 'time_tracking',           defaultEnabled: true,  overridableScopes: ['workspace', 'space', 'folder', 'list'] },
  { key: 'multiple_assignees',      label: 'multiple_assignees',      defaultEnabled: true,  overridableScopes: ['workspace', 'space'] },
  { key: 'sprint_points',           label: 'sprint_points',           defaultEnabled: true,  overridableScopes: ['workspace', 'space'] },
  { key: 'nested_subtasks',         label: 'nested_subtasks',         defaultEnabled: true,  overridableScopes: ['workspace', 'space', 'folder', 'list'] },
  { key: 'dependency_warning',      label: 'dependency_warning',      defaultEnabled: true,  overridableScopes: ['workspace', 'space'] },
  { key: 'reschedule_dependencies', label: 'reschedule_dependencies', defaultEnabled: true,  overridableScopes: ['workspace', 'space'] },
  { key: 'custom_task_ids',         label: 'custom_task_ids',         defaultEnabled: false, overridableScopes: ['workspace'] },
  { key: 'email',                   label: 'email',                   defaultEnabled: true,  overridableScopes: ['workspace'] },
] as const;

const REGISTRY_BY_KEY = new Map<AppKey, AppRegistryEntry>(APP_REGISTRY.map((e) => [e.key, e]));

/** One override row as usp_AppsEnabled_ListForScope returns it (camelCased). */
export interface OverrideRow {
  appKey:    AppKey;
  enabled:   boolean;
  scopeType: AppScopeType;
  scopeId:   string | null;
  depth:     number;        // higher = more specific (workspace=0 … list=9999)
}

/**
 * Most-specific-wins resolution for one app key over an ancestry override chain.
 * The chain is the (possibly empty) set of overrides on any ancestor of the
 * scope, for ANY app; we filter to `key` and pick the deepest. Unknown keys (not
 * in the registry) fail closed (disabled).
 */
export function resolveAppEnabled(key: AppKey, chain: OverrideRow[]): ResolvedApp {
  const entry = REGISTRY_BY_KEY.get(key);
  if (!entry) return { key, enabled: false, overridden: false, source: null };

  let winner: OverrideRow | null = null;
  for (const row of chain) {
    if (row.appKey !== key) continue;
    if (winner === null || row.depth > winner.depth) winner = row;
  }

  if (winner) return { key, enabled: winner.enabled, overridden: true, source: winner.scopeType };
  return { key, enabled: entry.defaultEnabled, overridden: false, source: null };
}

/** Resolve every registry app for a scope's override chain (for the frontend). */
export function resolveAllApps(chain: OverrideRow[]): ResolvedApp[] {
  return APP_REGISTRY.map((e) => resolveAppEnabled(e.key, chain));
}
```

- [ ] Run: `npm test --workspace apps/api -- resolve.unit`. Expected: PASS (8 tests).

- [ ] Commit:
```
git add packages/types/index.ts apps/api/src/modules/apps/app-registry.ts apps/api/src/modules/apps/__tests__/resolve.unit.test.ts
git commit -m "feat(10a): app-key registry + pure most-specific-wins resolver + unit tests"
```

---

### Task 4: Repository + service (per-request cached `isEnabled`/`resolveAll`)

**Files:**
- Create: `apps/api/src/modules/apps/app.repository.ts`
- Create: `apps/api/src/modules/apps/app.service.ts`

Steps:

- [ ] Write `app.repository.ts` — thin `execSp`/`execSpOne` wrappers over the two SPs, mapping PascalCase rows to the camelCase `OverrideRow`/`AppToggle` shapes:

```ts
import sql from 'mssql';
import { execSp, execSpOne } from '../../shared/lib/sqlClient.js';
import type { AppKey, AppScopeType, AppToggle } from '@projectflow/types';
import type { OverrideRow } from './app-registry.js';

interface ChainRowDb { AppKey: string; Enabled: boolean; ScopeType: string; ScopeId: string | null; Depth: number; }
interface ToggleRowDb { AppKey: string; Enabled: boolean; ScopeType: string; ScopeId: string | null; }

export class AppRepository {
  /** The ancestry override chain for a scope node (most-specific resolution input). */
  async listChainForScope(workspaceId: string, scopeType: AppScopeType, scopeId: string | null): Promise<OverrideRow[]> {
    const rows = await execSp<ChainRowDb>('usp_AppsEnabled_ListForScope', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'ScopeType',   type: sql.NVarChar(12),     value: scopeType },
      { name: 'ScopeId',     type: sql.UniqueIdentifier, value: scopeId },
    ]).then((sets) => sets[0] ?? []);
    return rows.map((r) => ({
      appKey: r.AppKey as AppKey, enabled: Boolean(r.Enabled),
      scopeType: r.ScopeType as AppScopeType, scopeId: r.ScopeId, depth: r.Depth,
    }));
  }

  /** Overrides for EXACTLY this scope (the App Center's own-rows view). */
  async listForScope(workspaceId: string, scopeType: AppScopeType, scopeId: string | null): Promise<AppToggle[]> {
    const chain = await this.listChainForScope(workspaceId, scopeType, scopeId);
    return chain
      .filter((r) => r.scopeType === scopeType && r.scopeId === scopeId)
      .map((r) => ({ appKey: r.appKey, scopeType: r.scopeType, scopeId: r.scopeId, enabled: r.enabled }));
  }

  /** Upsert (enabled=true|false) or clear (enabled=null) one override. */
  async setOverride(
    workspaceId: string, scopeType: AppScopeType, scopeId: string | null,
    appKey: AppKey, enabled: boolean | null, updatedBy: string | null,
  ): Promise<AppToggle | null> {
    const rows = await execSpOne<ToggleRowDb>('usp_AppsEnabled_Set', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'ScopeType',   type: sql.NVarChar(12),     value: scopeType },
      { name: 'ScopeId',     type: sql.UniqueIdentifier, value: scopeId },
      { name: 'AppKey',      type: sql.NVarChar(40),     value: appKey },
      { name: 'Enabled',     type: sql.Bit,              value: enabled },
      { name: 'UpdatedBy',   type: sql.UniqueIdentifier, value: updatedBy },
    ]);
    const r = rows[0];
    return r ? { appKey: r.AppKey as AppKey, scopeType: r.ScopeType as AppScopeType, scopeId: r.ScopeId, enabled: Boolean(r.Enabled) } : null;
  }
}
```

- [ ] Write `app.service.ts` — `isEnabled`/`resolveAll`/`setToggle` + the scope-node resolver from a task. The per-request cache is **keyed on the override chain** (one SP call per `(workspaceId, scopeType, scopeId)` per request) and is held by the caller (the middleware passes a cache map); the service itself memoizes nothing static so unit tests stay pure:

```ts
import { resolveAppEnabled, resolveAllApps, type OverrideRow } from './app-registry.js';
import { AppRepository } from './app.repository.js';
import { TaskRepository } from '../tasks/task.repository.js';
import { ListRepository } from '../hierarchy/list.repository.js';
import type { AppKey, AppScopeType, AppToggle, ResolvedApp } from '@projectflow/types';

export interface ScopeNode { workspaceId: string; scopeType: AppScopeType; scopeId: string | null; }

const repo     = new AppRepository();
const taskRepo = new TaskRepository();
const listRepo = new ListRepository();

export class AppService {
  /** Resolve the effective on/off for one app at a scope (most-specific-wins). */
  async isEnabled(appKey: AppKey, scope: ScopeNode): Promise<boolean> {
    const chain = await repo.listChainForScope(scope.workspaceId, scope.scopeType, scope.scopeId);
    return resolveAppEnabled(appKey, chain).enabled;
  }

  /** Resolve EVERY registry app at a scope (for the App Center + frontend gate). */
  async resolveAll(scope: ScopeNode): Promise<ResolvedApp[]> {
    const chain = await repo.listChainForScope(scope.workspaceId, scope.scopeType, scope.scopeId);
    return resolveAllApps(chain);
  }

  /** Same as resolveAll but reusing an already-fetched chain (cache path). */
  resolveAllFromChain(chain: OverrideRow[]): ResolvedApp[] { return resolveAllApps(chain); }

  /** Own-scope overrides for the App Center "this scope" column. */
  listForScope(scope: ScopeNode): Promise<AppToggle[]> {
    return repo.listForScope(scope.workspaceId, scope.scopeType, scope.scopeId);
  }

  /** Write an override (enabled=null clears it). */
  setToggle(scope: ScopeNode, appKey: AppKey, enabled: boolean | null, updatedBy: string | null): Promise<AppToggle | null> {
    return repo.setOverride(scope.workspaceId, scope.scopeType, scope.scopeId, appKey, enabled, updatedBy);
  }

  /** The override chain for a scope (the middleware caches this per request). */
  chainForScope(scope: ScopeNode): Promise<OverrideRow[]> {
    return repo.listChainForScope(scope.workspaceId, scope.scopeType, scope.scopeId);
  }

  /**
   * Resolve the most-specific scope node for a task: its List (the leaf scope an
   * app gate cares about). The List carries WorkspaceId; the ancestry walk in the
   * SP climbs from there. Returns null when the task is missing/unhomed (404).
   */
  async scopeNodeForTask(taskId: string): Promise<ScopeNode | null> {
    const task = await taskRepo.getById(taskId);
    const listId = (task as any)?.listId ?? (task as any)?.ListId ?? null;
    if (!listId) {
      // Fall back to the Space (project) scope when the task isn't in a List.
      const workspaceId = await taskRepo.getWorkspaceId(taskId);
      const projectId   = (task as any)?.projectId ?? (task as any)?.ProjectId ?? null;
      if (!workspaceId || !projectId) return null;
      return { workspaceId, scopeType: 'space', scopeId: projectId };
    }
    const workspaceId = await listRepo.getWorkspaceId(listId);
    if (!workspaceId) return null;
    return { workspaceId, scopeType: 'list', scopeId: listId };
  }
}

export const appService = new AppService();
```

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: PASS — no type errors (the new module compiles; `ListRepository.getWorkspaceId` + `TaskRepository.getById`/`getWorkspaceId` already exist). Also re-run `npm test --workspace apps/api -- resolve.unit` to confirm still green.

- [ ] Commit:
```
git add apps/api/src/modules/apps/app.repository.ts apps/api/src/modules/apps/app.service.ts
git commit -m "feat(10a): app repository + service — isEnabled/resolveAll/setToggle + task scope-node resolver"
```

---

### Task 5: `requireApp` middleware (REST) — composes with `requirePermission`

**Files:**
- Create: `apps/api/src/shared/middleware/requireApp.middleware.ts`
- Create: `apps/api/src/shared/middleware/__tests__/requireApp.unit.test.ts`

Steps:

- [ ] Write the failing unit test first — the gate's **decision** is the testable unit (scope resolution + enabled → next / disabled → 404 feature-absent). Stub the service to keep it pure:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { Context, Next } from 'hono';

// Mock the service the middleware delegates to BEFORE importing the middleware.
vi.mock('../../../modules/apps/app.service.js', () => ({
  appService: {
    chainForScope: vi.fn(async () => []),               // no overrides → registry default
    resolveAllFromChain: vi.fn(),
    isEnabled: vi.fn(),
  },
}));
import { appService } from '../../../modules/apps/app.service.js';
import { requireApp } from '../requireApp.middleware.js';

function fakeCtx(): { c: any; jsonArg: any } {
  const store = new Map<string, unknown>();
  const out: any = { jsonArg: undefined };
  const c: any = {
    get: (k: string) => store.get(k),
    set: (k: string, v: unknown) => store.set(k, v),
    req: { param: () => 't1' },
    json: (body: any, status?: number) => { out.jsonArg = { body, status }; return out.jsonArg; },
  };
  c.set('user', { userId: 'u1' });
  return { c, jsonArg: out };
}

const scope = { workspaceId: 'w1', scopeType: 'list' as const, scopeId: 'l1' };

describe('requireApp', () => {
  it('calls next() when the app resolves enabled', async () => {
    (appService.chainForScope as any).mockResolvedValue([]); // time_tracking defaults ON
    const { c } = fakeCtx();
    const next = vi.fn(async () => {});
    await requireApp('time_tracking', async () => scope)(c as Context, next as Next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns a 404 feature-absent when the app resolves disabled', async () => {
    // a list-level override turning it OFF
    (appService.chainForScope as any).mockResolvedValue([
      { appKey: 'time_tracking', enabled: false, scopeType: 'list', scopeId: 'l1', depth: 9999 },
    ]);
    const { c } = fakeCtx();
    const next = vi.fn(async () => {});
    const res: any = await requireApp('time_tracking', async () => scope)(c as Context, next as Next);
    expect(next).not.toHaveBeenCalled();
    expect(res.body.error.code).toBe('APP_DISABLED');
    expect(res.status).toBe(404);
  });

  it('returns 404 when the scope cannot be resolved (fail-closed)', async () => {
    const { c } = fakeCtx();
    const next = vi.fn(async () => {});
    const res: any = await requireApp('time_tracking', async () => null)(c as Context, next as Next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toBe(404);
  });
});
```

- [ ] Run: `npm test --workspace apps/api -- requireApp.unit`. Expected: FAIL — `Cannot find module '../requireApp.middleware.js'`.

- [ ] Write `requireApp.middleware.ts` — resolves a scope node, fetches its override chain (cached on the context like `loadPermissions`), resolves the app, and either calls `next()` or returns the **feature-absent 404**. Because it returns 404 (not 403) when disabled and is placed BEFORE `requirePermission` in a route's middleware chain, the two compose: an off app reads as "this feature does not exist here," distinct from a permission denial:

```ts
import type { Context, Next } from 'hono';
import { appService, type ScopeNode } from '../../modules/apps/app.service.js';
import { resolveAppEnabled } from '../../modules/apps/app-registry.js';
import type { AppKey } from '@projectflow/types';

/** Resolve the scope node a route's app gate applies to. Default: the task in
 *  the `:id` (or `taskId` body) param. Return null to fail-closed (404). */
export type ScopeResolver = (c: Context) => Promise<ScopeNode | null>;

/** Default resolver: the task at route param `:id`. */
const taskScopeFromParam: ScopeResolver = (c) => appService.scopeNodeForTask(c.req.param('id')!);

/**
 * Gate a route on whether an app is ENABLED for the resolved scope. ORTHOGONAL
 * to requirePermission: a disabled app is a 404 feature-absent (the feature does
 * not exist here), NOT a 403. Place this BEFORE requirePermission so a disabled
 * feature short-circuits before any permission work.
 *
 *   worklogRoutes.post('/', requireApp('time_tracking'),
 *     requirePermission('worklog.create', { resolveWorkspace }), handler);
 *
 * The resolved chain is cached on the Hono context (one SP call per scope per
 * request), mirroring loadPermissions' per-context permission cache.
 */
export function requireApp(appKey: AppKey, resolveScope: ScopeResolver = taskScopeFromParam) {
  return async (c: Context, next: Next) => {
    const scope = await resolveScope(c);
    if (!scope) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Resource not found', statusCode: 404 } }, 404);
    }

    const cacheKey = `appChain:${scope.scopeType}:${scope.scopeId ?? 'ws'}`;
    let chain = (c as any).get(cacheKey) as Awaited<ReturnType<typeof appService.chainForScope>> | undefined;
    if (chain === undefined) {
      chain = await appService.chainForScope(scope);
      (c as any).set(cacheKey, chain);
    }

    const { enabled } = resolveAppEnabled(appKey, chain);
    if (!enabled) {
      return c.json(
        { error: { code: 'APP_DISABLED', message: `Feature '${appKey}' is not enabled here`, statusCode: 404 } },
        404,
      );
    }
    await next();
  };
}
```

- [ ] Run: `npm test --workspace apps/api -- requireApp.unit`. Expected: PASS (3 tests). Then `npm run build --workspace apps/api`. Expected: PASS.

- [ ] Commit:
```
git add apps/api/src/shared/middleware/requireApp.middleware.ts apps/api/src/shared/middleware/__tests__/requireApp.unit.test.ts
git commit -m "feat(10a): requireApp middleware — feature-absent 404 gate composing with requirePermission"
```

---

### Task 6: REST routes (`/apps`) + server wiring

**Files:**
- Create: `apps/api/src/modules/apps/app.routes.ts`
- Modify: `apps/api/src/server.ts`

Steps:

- [ ] Write `app.routes.ts` — `GET /apps` (the registry + resolved-all for a scope), `GET /apps/:scopeType/:scopeId` (own-scope overrides), `PATCH /apps/:scopeType/:scopeId/:key` (write/clear). Writes are guarded by **both** `app.manage` (RBAC) AND `FULL` on the scope object (only someone who fully controls the object may change its apps), and publish a refresh so feature surfaces update live:

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { appService } from './app.service.js';
import { APP_REGISTRY } from './app-registry.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';
import { requireObjectAccess } from '../access/access.middleware.js';
import { ListRepository } from '../hierarchy/list.repository.js';
import { FolderRepository } from '../hierarchy/folder.repository.js';
import { ProjectRepository } from '../projects/project.repository.js';
import { pubsub } from '../../graphql/pubsub.js';
import type { AppKey, AppScopeType, ScopeNode } from '@projectflow/types';

const listRepo    = new ListRepository();
const folderRepo  = new FolderRepository();
const projectRepo = new ProjectRepository();

const SCOPE_TYPES = ['workspace', 'space', 'folder', 'list'] as const;
const APP_KEYS = APP_REGISTRY.map((e) => e.key) as [AppKey, ...AppKey[]];

const scopeParam = z.enum(SCOPE_TYPES);
const setSchema = z.object({ enabled: z.boolean().nullable() }); // null clears the override

/** Resolve the workspace id for a scope (workspace/space/folder/list). */
async function workspaceForScope(scopeType: AppScopeType, scopeId: string | null): Promise<string | null> {
  if (scopeType === 'workspace') return scopeId;               // workspace scope: :scopeId IS the workspace id
  if (scopeType === 'space')  return projectRepo.getWorkspaceId(scopeId!);
  if (scopeType === 'folder') return folderRepo.getWorkspaceId(scopeId!);
  return listRepo.getWorkspaceId(scopeId!);
}

/** Build a ScopeNode from the route params; workspace scope carries scopeId=null. */
async function scopeNodeFromParams(scopeType: AppScopeType, rawScopeId: string): Promise<ScopeNode | null> {
  if (scopeType === 'workspace') return { workspaceId: rawScopeId, scopeType, scopeId: null };
  const workspaceId = await workspaceForScope(scopeType, rawScopeId);
  if (!workspaceId) return null;
  return { workspaceId, scopeType, scopeId: rawScopeId };
}

export const appRoutes = new Hono();

// GET /apps?workspaceId=&scopeType=&scopeId=  — the registry + resolved-all for a scope.
appRoutes.get('/', async (c) => {
  const workspaceId = c.req.query('workspaceId');
  const scopeType   = (c.req.query('scopeType') ?? 'workspace') as AppScopeType;
  const scopeId     = c.req.query('scopeId') ?? null;
  if (!workspaceId) return c.json({ error: { code: 'BAD_REQUEST', message: 'workspaceId required' } }, 400);
  const scope: ScopeNode = { workspaceId, scopeType, scopeId: scopeType === 'workspace' ? null : scopeId };
  const apps = await appService.resolveAll(scope);
  return c.json({ data: { registry: APP_REGISTRY, apps } });
});

// GET /apps/:scopeType/:scopeId — own-scope overrides only (App Center "this scope" column).
appRoutes.get('/:scopeType/:scopeId', async (c) => {
  const parsed = scopeParam.safeParse(c.req.param('scopeType'));
  if (!parsed.success) return c.json({ error: { code: 'BAD_REQUEST', message: 'invalid scopeType' } }, 400);
  const scope = await scopeNodeFromParams(parsed.data, c.req.param('scopeId'));
  if (!scope) return c.json({ error: { code: 'NOT_FOUND', message: 'Scope not found' } }, 404);
  return c.json({ data: await appService.listForScope(scope) });
});

// PATCH /apps/:scopeType/:scopeId/:key  { enabled: bool|null } — write/clear an override.
// Guard: app.manage (RBAC) AND FULL on the object (only full controllers may toggle).
appRoutes.patch(
  '/:scopeType/:scopeId/:key',
  zValidator('json', setSchema),
  requirePermission('app.manage', {
    resolveWorkspace: (c) => workspaceForScope(c.req.param('scopeType') as AppScopeType, c.req.param('scopeId')),
  }),
  // FULL on the object — workspace scope has no hierarchy object, so the
  // resolver returns null there and requireObjectAccess is a no-op skip; the
  // app.manage gate (owner/admin) already covers the workspace root.
  requireObjectAccess('FULL', (c) => {
    const st = c.req.param('scopeType');
    if (st === 'workspace') return null;                 // no object-level row at the root
    const map: Record<string, 'SPACE' | 'FOLDER' | 'LIST'> = { space: 'SPACE', folder: 'FOLDER', list: 'LIST' };
    return { type: map[st], id: c.req.param('scopeId') };
  }),
  async (c) => {
    const parsed = scopeParam.safeParse(c.req.param('scopeType'));
    if (!parsed.success) return c.json({ error: { code: 'BAD_REQUEST', message: 'invalid scopeType' } }, 400);
    const appKey = c.req.param('key');
    if (!APP_KEYS.includes(appKey as AppKey)) return c.json({ error: { code: 'BAD_REQUEST', message: 'unknown app key' } }, 400);
    const scope = await scopeNodeFromParams(parsed.data, c.req.param('scopeId'));
    if (!scope) return c.json({ error: { code: 'NOT_FOUND', message: 'Scope not found' } }, 404);

    const user = (c as any).get('user') as any;
    const { enabled } = c.req.valid('json');
    const toggle = await appService.setToggle(scope, appKey as AppKey, enabled, user?.userId ?? null);
    // Publish a scope-keyed refresh so feature surfaces appear/disappear live.
    await pubsub.publish(`app:toggled:${scope.workspaceId}`, { workspaceId: scope.workspaceId, scope, appKey, enabled });
    return c.json({ data: toggle });
  },
);
```

> If `requireObjectAccess`'s resolver returning `null` is NOT treated as "skip" by the existing middleware (it returns 404 on a null id — see `access.middleware.ts`), apply object-FULL only for the hierarchy scopes by mounting that middleware on a sub-route or branching: split the workspace-scope PATCH (guarded by `app.manage` alone) from the space/folder/list PATCH (guarded by `app.manage` + `requireObjectAccess('FULL', …)`). Verify against the read of `access.middleware.ts` during implementation and adjust.

- [ ] Wire the routes into `server.ts`. Add the import alongside the others, the `authMiddleware` mount, and the route:

```ts
import { appRoutes } from './modules/apps/app.routes.js';
```
```ts
app.use('/apps/*', authMiddleware);   // with the other app.use('/<x>/*', authMiddleware) lines
```
```ts
app.route('/apps', appRoutes);        // with the other app.route('/<x>', …) lines
```

- [ ] Run: `npm run build --workspace apps/api`. Expected: PASS — routes compile, server wiring type-checks. (`ProjectRepository.getWorkspaceId`/`FolderRepository.getWorkspaceId` exist mirroring `ListRepository.getWorkspaceId`; if a repo lacks it, add a one-line `getWorkspaceId` SP wrapper in the same file matching `list.repository.ts:25`.)

- [ ] Commit:
```
git add apps/api/src/modules/apps/app.routes.ts apps/api/src/server.ts
git commit -m "feat(10a): /apps REST — registry+resolve read, scope overrides, app.manage+FULL guarded toggle"
```

---

### Task 7: Retrofit `requireApp` onto Time Tracking + integration test

**Files:**
- Modify: `apps/api/src/modules/worklogs/worklog.routes.ts`
- Create: `apps/api/src/modules/apps/__tests__/apps.integration.test.ts`

Steps:

- [ ] Write the failing integration test first (copy the harness imports from an existing integration test — `testServer.js`, `truncate.js`, `factories.js`). It proves §4.5 acceptance at the API layer: disabling Time Tracking at a Space makes the worklog endpoints feature-absent beneath it, while a sibling Space keeps them, and re-enabling restores:

```ts
/**
 * Phase 10a — Apps / feature toggles integration coverage.
 * Disabling Time Tracking at a Space makes the worklog/timer endpoints
 * feature-absent (APP_DISABLED / 404) for tasks beneath it; a sibling Space is
 * unaffected; re-enabling restores. Also asserts the toggle write is FULL-gated.
 * DB SAFETY: must target local Docker ProjectFlow_Test (see e2e/README).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

async function seedSpaceWithTask(token: string, wsId: string, name: string, key: string) {
  const space = await createTestProject(wsId, token, { name, key });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token, json: { workspaceId: wsId, spaceId: space.Id, folderId: null, name: 'L', position: 0 },
  }), 201)).data;
  const task = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token, json: { projectId: space.Id, workspaceId: wsId, title: 'T', listId: list.id },
  }), 201)).data;
  return { spaceId: space.Id, taskId: task.id };
}

describe('app toggles — Time Tracking feature-absent under a disabled Space', () => {
  it('disabling at Space A hides worklogs for A, leaves sibling B intact, re-enable restores', async () => {
    const owner = await createTestUser({ email: `apps-${Date.now()}@projectflow.test` });
    const token = owner.accessToken;
    const ws = await createTestWorkspace(token);
    const a = await seedSpaceWithTask(token, ws.Id, 'Space A', `AA${Date.now() % 100000}`);
    const b = await seedSpaceWithTask(token, ws.Id, 'Space B', `BB${Date.now() % 100000}`);

    // Baseline: time tracking ON by default → creating a worklog succeeds in both.
    const logBody = (taskId: string) => ({ taskId, timeSpentSeconds: 600, startedAt: new Date().toISOString() });
    await json(await request('/worklogs', { method: 'POST', token, json: logBody(a.taskId) }), 201);
    await json(await request('/worklogs', { method: 'POST', token, json: logBody(b.taskId) }), 201);

    // Disable Time Tracking at Space A (owner has FULL on the space).
    await json(await request(`/apps/space/${a.spaceId}/time_tracking`, {
      method: 'PATCH', token, json: { enabled: false },
    }));

    // A task under Space A: worklog endpoints now feature-absent (404 APP_DISABLED).
    const denied = await request('/worklogs', { method: 'POST', token, json: logBody(a.taskId) });
    expect(denied.status).toBe(404);
    expect((await denied.json()).error.code).toBe('APP_DISABLED');
    const deniedList = await request(`/worklogs?taskId=${a.taskId}`, { token });
    expect(deniedList.status).toBe(404);

    // Sibling Space B is unaffected.
    await json(await request('/worklogs', { method: 'POST', token, json: logBody(b.taskId) }), 201);

    // Re-enable A (clear the override) → restored.
    await json(await request(`/apps/space/${a.spaceId}/time_tracking`, {
      method: 'PATCH', token, json: { enabled: null },
    }));
    await json(await request('/worklogs', { method: 'POST', token, json: logBody(a.taskId) }), 201);
  });

  it('a non-FULL member cannot toggle an app (fail-closed)', async () => {
    const owner = await createTestUser({ email: `apps-own-${Date.now()}@projectflow.test` });
    const token = owner.accessToken;
    const ws = await createTestWorkspace(token);
    const a = await seedSpaceWithTask(token, ws.Id, 'Space A', `CC${Date.now() % 100000}`);
    // A second user with only VIEW (no app.manage, no FULL) — invite as viewer.
    const viewer = await createTestUser({ email: `apps-view-${Date.now()}@projectflow.test` });
    // (Use the existing member-invite + role-assign factory helpers to add `viewer`
    //  to `ws` as workspace-viewer; then attempt the toggle with viewer.accessToken.)
    const res = await request(`/apps/space/${a.spaceId}/time_tracking`, {
      method: 'PATCH', token: viewer.accessToken, json: { enabled: false },
    });
    expect([403, 404]).toContain(res.status);   // FORBIDDEN (no app.manage) — fail-closed
  });
});
```

- [ ] Run: `npm run test:integration --workspace apps/api -- apps.integration` against `ProjectFlow_Test`. Expected: FAIL — worklog routes still accept writes under a disabled Space (no `requireApp` gate yet); the first test fails at the `404`/`APP_DISABLED` assertion.

- [ ] Retrofit `requireApp('time_tracking')` onto every worklog route. Import the middleware + a body-scope resolver (for `POST /worklogs` the task is in the body, not `:id`), and place `requireApp` BEFORE the existing `requirePermission`/handler. Edit `worklog.routes.ts`:

```ts
import { requireApp } from '../../shared/middleware/requireApp.middleware.js';
import { appService } from '../apps/app.service.js';

// Resolve the scope node from the body's taskId (for create) or the worklog's task (for :id).
const scopeFromBodyTask = async (c: any) => {
  try { const body = await c.req.json(); return body?.taskId ? appService.scopeNodeForTask(body.taskId) : null; }
  catch { return null; }
};
const scopeFromQueryTask = async (c: any) => {
  const taskId = c.req.query('taskId'); return taskId ? appService.scopeNodeForTask(taskId) : null;
};
const scopeFromWorklogId = async (c: any) => {
  const ctx = await worklogRepoForLookup.getContext(c.req.param('id')!);
  return ctx?.taskId ? appService.scopeNodeForTask(ctx.taskId) : null;
};
```

Apply the gate to each route (shown for the existing routes; the same gate is the FIRST middleware on any timer/estimate/rollup routes from Phase 8a if those have landed):

```ts
// GET /worklogs?taskId=
worklogRoutes.get('/', requireApp('time_tracking', scopeFromQueryTask), async (c) => { /* unchanged body */ });

// POST /worklogs
worklogRoutes.post('/',
  zValidator('json', createSchema),
  requireApp('time_tracking', scopeFromBodyTask),
  requirePermission('worklog.create', { resolveWorkspace: resolveTaskWorkspaceFromBody }),
  async (c) => { /* unchanged body */ });

// PATCH /worklogs/:id
worklogRoutes.patch('/:id',
  requireApp('time_tracking', scopeFromWorklogId),
  requirePermission('worklog.update.own', { resolveWorkspace: resolveWorklogWorkspace, ownerOnly: resolveWorklogOwner }),
  zValidator('json', updateSchema),
  async (c) => { /* unchanged body */ });

// DELETE /worklogs/:id
worklogRoutes.delete('/:id',
  requireApp('time_tracking', scopeFromWorklogId),
  requirePermission('worklog.delete.any', { resolveWorkspace: resolveWorklogWorkspace, ownerFallback: { slug: 'worklog.delete.own', resolveOwner: resolveWorklogOwner } }),
  async (c) => { /* unchanged body */ });
```

> If the Phase 8a timer/estimate routes (`/worklogs/timer/start|stop|active`, `/worklogs/tasks/:taskId/estimate|rollup`) exist on-disk, add `requireApp('time_tracking', …)` as their first middleware too (the timer/active routes resolve scope via the authed user's active-timer task or the `:taskId` param). If Phase 8a has NOT merged, this slice gates only the CRUD worklog routes above; **note inline** that the timer/estimate routes inherit the same gate when they land.

- [ ] Run: `npm run test:integration --workspace apps/api -- apps.integration` against `ProjectFlow_Test`. Expected: PASS (2 tests). Then full unit + integration regression: `npm test --workspace apps/api` and `npm run test:integration --workspace apps/api -- worklog`. Expected: PASS (existing worklog tests still green — default-on means no behavior change unless an override exists).

- [ ] Commit:
```
git add apps/api/src/modules/worklogs/worklog.routes.ts apps/api/src/modules/apps/__tests__/apps.integration.test.ts
git commit -m "feat(10a): retrofit requireApp('time_tracking') onto worklog routes + acceptance integration test"
```

---

### Task 8: Retrofit `requireApp` onto the remaining optional task features

**Files:**
- Modify: `apps/api/src/modules/tasks/task.routes.ts`

Steps:

- [ ] Add the imports + a `:id`-task scope resolver to `task.routes.ts`:

```ts
import { requireApp } from '../../shared/middleware/requireApp.middleware.js';
import { appService } from '../apps/app.service.js';

// Scope node from the route's :id task (the leaf List/Space the app gate cares about).
const scopeFromIdTask = (c: any) => appService.scopeNodeForTask(c.req.param('id')!);
```

- [ ] **Multiple Assignees** — gate `PUT /:id/assignees` (the multi-assignee write). Add `requireApp('multiple_assignees', scopeFromIdTask)` as the FIRST middleware on the existing route:

```ts
taskRoutes.put('/:id/assignees',
  requireApp('multiple_assignees', scopeFromIdTask),
  requirePermission('task.assign', { resolveWorkspace: resolveTaskWorkspace }),
  zValidator('json', assigneesSchema),
  async (c) => { /* unchanged body — still throws MultipleAssigneesDisabledError on its own SP guard */ });
```

> The existing `MultipleAssigneesDisabledError` (a Space-setting toggle predating this slice) is a DIFFERENT mechanism (a column on the Space). `requireApp('multiple_assignees')` is the new, hierarchy-resolved gate; both can coexist — `requireApp` short-circuits with 404 when the app is off before the SP-level error can fire. Note this overlap in `DECISIONS.md`.

- [ ] **Nested Subtasks** — gate task creation when a `parentTaskId` is present (creating a subtask). Since the gate is conditional on the body, resolve scope from the parent task and short-circuit only for subtask creates. Add a thin wrapper middleware on `POST /`:

```ts
// Conditionally gate subtask creation on the nested_subtasks app.
const requireNestedSubtasksIfParent = async (c: any, next: any) => {
  let body: any; try { body = await c.req.json(); } catch { body = {}; }
  if (!body?.parentTaskId) return next();   // a top-level task — no nested gate
  return requireApp('nested_subtasks', async () => appService.scopeNodeForTask(body.parentTaskId))(c, next);
};
```

Insert it BEFORE the existing `requirePermission('task.create', …)` on `POST /`:

```ts
taskRoutes.post('/',
  zValidator('json', createSchema),
  requireNestedSubtasksIfParent,
  requirePermission('task.create', { resolveWorkspace: async (c) => (c.req.valid('json' as never) as any)?.workspaceId ?? null }),
  async (c) => { /* unchanged body */ });
```

- [ ] **Dependency Warning** — gate the dependency edge routes + the transition path that can raise `DependencyWarningError`. Add `requireApp('dependency_warning', scopeFromIdTask)` as the first middleware on the dependency read/add/remove routes and the transition route:

```ts
taskRoutes.get('/:id/dependencies',
  requireApp('dependency_warning', scopeFromIdTask),
  requireObjectAccess('VIEW', async (c) => { const lid = taskListId(await taskRepo.getById(c.req.param('id')!)); return lid ? { type: 'LIST', id: lid } : null; }),
  async (c) => c.json({ data: await dependencyService.list(c.req.param('id')!) }));

taskRoutes.post('/:id/dependencies',
  requireApp('dependency_warning', scopeFromIdTask),
  requirePermission('task.update', { resolveWorkspace: resolveTaskWorkspace }),
  async (c) => { /* unchanged body */ });

taskRoutes.delete('/:id/dependencies/:otherId',
  requireApp('dependency_warning', scopeFromIdTask),
  requirePermission('task.update', { resolveWorkspace: resolveTaskWorkspace }),
  async (c) => { /* unchanged body */ });
```

> The `PATCH /:id/transition` handler maps `DependencyWarningError` → 409. With `dependency_warning` OFF for a scope, the warning must not block transitions. Rather than gating the whole transition route (transitions must always work), guard ONLY the warning behavior: in the transition handler, before re-throwing `DependencyWarningError`, check `await appService.isEnabled('dependency_warning', scope)` and, when disabled, let the transition proceed (swallow the warning). Implement this inside the existing `catch` branch (do not 404 the transition):

```ts
// inside PATCH /:id/transition catch:
if (err instanceof DependencyWarningError) {
  const scope = await appService.scopeNodeForTask(id);
  const warn = scope ? await appService.isEnabled('dependency_warning', scope) : true;
  if (warn) return c.json({ error: { code: err.code, message: err.message, details: { blockers: err.blockers } } }, 409);
  // dependency_warning OFF here → ignore the warning and complete the transition.
  const task = await taskService.transitionTask(id, status, actorId, { force: true });
  if (task) { await invalidateTaskCaches(taskProjectId(task)); await publishTaskEvent('updated', { projectId: taskProjectId(task) as string, task }); }
  return c.json({ data: task });
}
```

> Confirm `transitionTask` accepts a `force`/`ignoreDependencyWarning` option during implementation; if it does not, thread a minimal flag through the service so a disabled-warning scope can complete the transition. Note in `DECISIONS.md`.

- [ ] **Reschedule Dependencies** — the dependency-reschedule cascade fires on a task date update (Phase 5). Gate it with `requireApp('reschedule_dependencies', …)` at the point the reschedule is invoked: in the `PATCH /:id` / date-update handler, only run the cascade when the app resolves enabled for the task's scope:

```ts
// in the task-date-update handler, where the reschedule cascade is triggered:
const scope = await appService.scopeNodeForTask(id);
if (scope && await appService.isEnabled('reschedule_dependencies', scope)) {
  await dependencyService.rescheduleDependents(id /* , delta */);
}
```

> Locate the exact reschedule call site during implementation (search `reschedule` in `dependency.service.ts` + `task.routes.ts`); wrap only that cascade in the `isEnabled('reschedule_dependencies')` check. The base date update always proceeds — only the cascade is gated.

- [ ] **Inline notes for features not yet on-disk** (do NOT fabricate routes):
  - **Sprint Points (Phase 8c):** when the sprint-points field/column lands, gate its write route with `requireApp('sprint_points', scopeFromIdTask)` as the first middleware, mirroring the assignees gate. *Not applied now — feature absent on-disk.*
  - **Custom Task IDs:** when the custom-task-id generator lands, gate its config/format endpoints with `requireApp('custom_task_ids', …)` (workspace-scope only per the registry). Default is OFF. *Not applied now.*
  - **Email:** when the SMTP/email-send path lands (deferred to Phase 12 per the spec), gate the send call with `appService.isEnabled('email', scope)` rather than a route gate (email is a service-layer side-effect, not a user-facing route). *Not applied now.*

- [ ] Run: `npm run build --workspace apps/api`. Expected: PASS. Then `npm run test:integration --workspace apps/api -- task` and `npm test --workspace apps/api`. Expected: PASS — default-on apps mean existing task tests are unchanged; add a focused assertion to `apps.integration.test.ts` if convenient (e.g. assignees 404 under a space with `multiple_assignees` disabled).

- [ ] Commit:
```
git add apps/api/src/modules/tasks/task.routes.ts
git commit -m "feat(10a): retrofit requireApp onto assignees/nested-subtasks/dependency-warning/reschedule + inline notes for sprint-points/custom-ids/email"
```

---

### Task 9: GraphQL mirror (`apps.schema.ts`) + the GraphQL `requireApp` equivalent

**Files:**
- Create: `apps/api/src/graphql/apps.schema.ts`
- Modify: `apps/api/src/graphql/schema.ts` (import + call near the other `register*Graphql()` calls)
- Modify (if present): `apps/api/src/graphql/worklog.schema.ts` (gate the worklog mirror resolvers)

Steps:

- [ ] Write `apps.schema.ts`, mirroring `recurrence.schema.ts`'s structure (typed `objectRef`, `notFound`/`requireWorkspacePermission`/`requireObjectLevel` from `./authz.js`, delegating to the shared `appService`). It exposes the `AppToggle`/`ResolvedApp` shapes, an `appToggles` query, a `setAppToggle` mutation, and the GraphQL `requireApp` equivalent `assertAppEnabled` (a 404 NOT_FOUND for a disabled app, mirroring the REST feature-absent semantics):

```ts
import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { appService, type ScopeNode } from '../modules/apps/app.service.js';
import { resolveAppEnabled } from '../modules/apps/app-registry.js';
import { ProjectRepository } from '../modules/projects/project.repository.js';
import { FolderRepository } from '../modules/hierarchy/folder.repository.js';
import { ListRepository } from '../modules/hierarchy/list.repository.js';
import { requireWorkspacePermission, requireObjectLevel } from './authz.js';
import type { AppKey, AppScopeType, ResolvedApp } from '@projectflow/types';

const projectRepo = new ProjectRepository();
const folderRepo  = new FolderRepository();
const listRepo    = new ListRepository();

const OBJECT_TYPE: Record<Exclude<AppScopeType, 'workspace'>, 'SPACE' | 'FOLDER' | 'LIST'> =
  { space: 'SPACE', folder: 'FOLDER', list: 'LIST' };

async function scopeNode(scopeType: AppScopeType, scopeId: string | null): Promise<ScopeNode | null> {
  if (scopeType === 'workspace') return scopeId ? { workspaceId: scopeId, scopeType, scopeId: null } : null;
  if (!scopeId) return null;
  const workspaceId =
    scopeType === 'space'  ? await projectRepo.getWorkspaceId(scopeId) :
    scopeType === 'folder' ? await folderRepo.getWorkspaceId(scopeId)  :
                             await listRepo.getWorkspaceId(scopeId);
  return workspaceId ? { workspaceId, scopeType, scopeId } : null;
}

/**
 * GraphQL equivalent of requireApp: throw NOT_FOUND (feature-absent) when an app
 * is disabled for a scope. Mirrors the REST 404, orthogonal to a FORBIDDEN
 * permission error. Call it alongside requireWorkspacePermission in a resolver
 * for a gated feature (e.g. the worklog mirror).
 */
export async function assertAppEnabled(appKey: AppKey, scope: ScopeNode | null): Promise<void> {
  if (!scope) throw new GraphQLError('Resource not found', { extensions: { code: 'NOT_FOUND' } });
  const chain = await appService.chainForScope(scope);
  if (!resolveAppEnabled(appKey, chain).enabled) {
    throw new GraphQLError(`Feature '${appKey}' is not enabled here`, { extensions: { code: 'APP_DISABLED' } });
  }
}

export function registerAppsGraphql(): void {
  const ResolvedAppType = builder.objectRef<ResolvedApp>('AppToggle');
  ResolvedAppType.implement({ fields: (t) => ({
    key:        t.exposeString('key'),
    enabled:    t.boolean({ resolve: (a) => a.enabled }),
    overridden: t.boolean({ resolve: (a) => a.overridden }),
    source:     t.string({ nullable: true, resolve: (a) => a.source ?? null }),
  }) });

  builder.queryFields((t) => ({
    appToggles: t.field({
      type: [ResolvedAppType],
      args: { scopeType: t.arg.string({ required: true }), scopeId: t.arg.string({ required: false }) },
      resolve: async (_, a, ctx) => {
        const scope = await scopeNode(a.scopeType as AppScopeType, a.scopeId ?? null);
        if (!scope) throw new GraphQLError('Scope not found', { extensions: { code: 'NOT_FOUND' } });
        // VIEW is enough to READ the resolved app set (it drives UI surfacing).
        await requireWorkspacePermission(ctx, scope.workspaceId, 'workspace.read');
        return appService.resolveAll(scope);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    setAppToggle: t.field({
      type: 'Boolean',
      args: {
        scopeType: t.arg.string({ required: true }),
        scopeId:   t.arg.string({ required: false }),
        appKey:    t.arg.string({ required: true }),
        enabled:   t.arg.boolean({ required: false }), // null/omitted clears the override
      },
      resolve: async (_, a, ctx) => {
        const scope = await scopeNode(a.scopeType as AppScopeType, a.scopeId ?? null);
        if (!scope) throw new GraphQLError('Scope not found', { extensions: { code: 'NOT_FOUND' } });
        await requireWorkspacePermission(ctx, scope.workspaceId, 'app.manage');
        if (scope.scopeType !== 'workspace') {
          await requireObjectLevel(ctx, OBJECT_TYPE[scope.scopeType], scope.scopeId, 'FULL');
        }
        await appService.setToggle(scope, a.appKey as AppKey, a.enabled ?? null, (ctx.user as any).userId);
        return true;
      },
    }),
  }));
}
```

- [ ] Wire it into `schema.ts` — add the import alongside the others and the registration call near the other `register*Graphql()` calls:

```ts
import { registerAppsGraphql } from './apps.schema.js';
```
```ts
// ─────────────────────────────────────────
// Apps / feature toggles (Phase 10a) — AppToggle type + appToggles query +
// setAppToggle mutation (app.manage + FULL gated). assertAppEnabled gates the
// optional-feature mirror resolvers (worklog, …).
// ─────────────────────────────────────────
registerAppsGraphql();
```

- [ ] If `apps/api/src/graphql/worklog.schema.ts` exists (Phase 8a mirror), add `assertAppEnabled('time_tracking', await appService.scopeNodeForTask(a.taskId))` alongside the existing `requireWorkspacePermission(... 'worklog.create')` in the `startTimer`/`createWorkLog`/`taskWorkLogs`/`taskTimeRollup` resolvers. If it does NOT exist yet, **note inline** in `DECISIONS.md` that the GraphQL worklog mirror inherits `assertAppEnabled('time_tracking')` when it lands.

- [ ] Run: `npm run build --workspace apps/api` (tsc — compiles the Pothos schema). Expected: PASS — schema builds. Then `npm test --workspace apps/api`. Expected: PASS (existing GraphQL authz tests still green).

- [ ] Commit:
```
git add apps/api/src/graphql/apps.schema.ts apps/api/src/graphql/schema.ts
git commit -m "feat(10a): GraphQL apps mirror — appToggles query + setAppToggle mutation + assertAppEnabled gate"
```

---

### Task 10: Server actions + App Center grid + i18n

**Files:**
- Create: `apps/next-web/src/server/actions/apps.ts`
- Create: `apps/next-web/src/components/AppCenter.tsx`
- Create: `apps/next-web/src/components/AppCenter.module.css`
- Create: `apps/next-web/src/lib/appGate.ts`
- Create: `apps/next-web/src/app/(app)/workspaces/[id]/settings/app-center-section.tsx`
- Modify: `apps/next-web/src/messages/en.json`
- Modify: `apps/next-web/src/messages/id.json`
- Note: read `apps/next-web/AGENTS.md` + the in-repo `node_modules/next/dist/docs/` before writing web code (this Next.js has breaking changes).

Steps:

- [ ] Add server actions to `apps/next-web/src/server/actions/apps.ts` — mirror `hierarchy.ts`'s `requireSession()` + `serverFetch` + `ActionResult` shape:

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';
import type { AppRegistryEntry, ResolvedApp, AppScopeType, AppKey } from '@projectflow/types';

/** Resolve the registry + the effective app set for a scope. */
export async function loadAppToggles(
  workspaceId: string, scopeType: AppScopeType, scopeId: string | null,
): Promise<ActionResult<{ registry: AppRegistryEntry[]; apps: ResolvedApp[] }>> {
  await requireSession();
  try {
    const qs = new URLSearchParams({ workspaceId, scopeType, ...(scopeId ? { scopeId } : {}) });
    const res = await serverFetch(`/apps?${qs.toString()}`, { method: 'GET' });
    return { ok: true, data: (res as any).data };
  } catch (e) { return toActionError(e); }
}

/** Write (enabled=true|false) or clear (enabled=null) one override. */
export async function setAppToggle(
  scopeType: AppScopeType, scopeId: string, appKey: AppKey, enabled: boolean | null,
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/apps/${scopeType}/${encodeURIComponent(scopeId)}/${appKey}`, {
      method: 'PATCH', body: JSON.stringify({ enabled }),
    });
  } catch (e) { return toActionError(e); }
  revalidatePath('/'); return { ok: true };
}
```

> Adapt the `serverFetch` return-shape handling to the file's existing convention (verify `serverFetch` returns the parsed `{ data }` body vs. a Response during implementation — match `hierarchy.ts`/`tasks.ts`).

- [ ] Write `lib/appGate.ts` — a tiny client helper so feature surfaces can ask "is this app on for the current scope?" The resolved set is fetched once per scope (passed down from a server component) and read by surfaces (timer widget, sprint-points column, dependency warnings):

```ts
import type { ResolvedApp, AppKey } from '@projectflow/types';

/** True when `key` is enabled in a resolved app set (default-closed if absent). */
export function isAppOn(apps: ResolvedApp[] | undefined, key: AppKey): boolean {
  if (!apps) return false;                       // unknown set → fail-closed (hide)
  return apps.find((a) => a.key === key)?.enabled ?? false;
}
```

- [ ] Write `AppCenter.tsx` — a client component: a toggle grid showing every registry app with its label, description, current resolved state, an inheritance indicator (e.g. "Inherited from workspace" when `overridden=false` or `source` differs from the current scope), and an on/off switch that calls `setAppToggle`. Only apps whose `overridableScopes` include the current `scopeType` render a live switch; others render read-only:

```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { loadAppToggles, setAppToggle } from '@/server/actions/apps';
import { notifyActionError } from '@/lib/apiErrorToast';
import styles from './AppCenter.module.css';
import type { AppRegistryEntry, ResolvedApp, AppScopeType, AppKey } from '@projectflow/types';

export function AppCenter({ workspaceId, scopeType, scopeId }: { workspaceId: string; scopeType: AppScopeType; scopeId: string | null }) {
  const t = useTranslations('AppCenter');
  const [registry, setRegistry] = useState<AppRegistryEntry[]>([]);
  const [apps, setApps] = useState<ResolvedApp[]>([]);
  const [pending, start] = useTransition();

  const refetch = () => loadAppToggles(workspaceId, scopeType, scopeId).then((r) => {
    if (r.ok) { setRegistry(r.data.registry); setApps(r.data.apps); }
  });
  useEffect(() => { refetch(); /* eslint-disable-line */ }, [workspaceId, scopeType, scopeId]);

  const stateOf = (key: AppKey) => apps.find((a) => a.key === key);

  const onToggle = (key: AppKey, next: boolean) => start(async () => {
    // scopeId is required for non-workspace scopes; the workspace scope uses the
    // workspaceId as its identity on the REST path.
    const id = scopeType === 'workspace' ? workspaceId : (scopeId ?? '');
    const r = await setAppToggle(scopeType, id, key, next);
    if (!r.ok) return notifyActionError(r);
    await refetch();
  });

  return (
    <div className={styles.grid} role="list" aria-label={t('title')}>
      {registry.map((entry) => {
        const st = stateOf(entry.key);
        const enabled = st?.enabled ?? entry.defaultEnabled;
        const inherited = !(st?.overridden) || (st?.source && st.source !== scopeType);
        const overridable = entry.overridableScopes.includes(scopeType);
        return (
          <div key={entry.key} role="listitem" className={styles.row} data-app={entry.key} data-enabled={enabled}>
            <div className={styles.meta}>
              <span className={styles.label}>{t(`apps.${entry.label}.label`)}</span>
              <span className={styles.desc}>{t(`apps.${entry.label}.desc`)}</span>
              {inherited && <span className={styles.inherited}>{t('inheritedFrom', { scope: st?.source ?? 'default' })}</span>}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              disabled={!overridable || pending}
              className={`${styles.switch} ${enabled ? styles.on : styles.off}`}
              onClick={() => onToggle(entry.key, !enabled)}
              aria-label={t('toggle', { app: t(`apps.${entry.label}.label`) })}
            >
              <span className={styles.knob} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] Write `AppCenter.module.css`:

```css
.grid { display: flex; flex-direction: column; gap: 8px; }
.row { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border: 1px solid var(--border, #e5e7eb); border-radius: 10px; }
.meta { display: flex; flex-direction: column; gap: 2px; }
.label { font-weight: 600; }
.desc { font-size: 12px; color: var(--text-2, #6b7280); }
.inherited { font-size: 11px; color: var(--text-3, #9ca3af); font-style: italic; }
.switch { position: relative; width: 40px; height: 22px; border: none; border-radius: 11px; cursor: pointer; transition: background .15s; }
.switch:disabled { opacity: .5; cursor: default; }
.switch.on { background: #22c55e; }
.switch.off { background: #d1d5db; }
.knob { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform .15s; }
.switch.on .knob { transform: translateX(18px); }
```

- [ ] Write the workspace-settings mount `app-center-section.tsx` (server component that reads the workspace id and renders the client grid):

```tsx
import { AppCenter } from '@/components/AppCenter';

export function AppCenterSection({ workspaceId }: { workspaceId: string }) {
  return <AppCenter workspaceId={workspaceId} scopeType="workspace" scopeId={null} />;
}
```

Mount `<AppCenterSection workspaceId={…} />` inside the existing `workspace-settings-view.tsx` (a new "Apps" section). Verify the file's section/tab pattern during implementation and follow it.

- [ ] Add the `AppCenter` namespace to `apps/next-web/messages/en.json` (one `apps.<label>.label`/`.desc` pair per registry app — keys must match `app-registry.ts` `label` values exactly):

```json
"AppCenter": {
  "title": "App Center",
  "toggle": "Toggle {app}",
  "inheritedFrom": "Inherited from {scope}",
  "apps": {
    "time_tracking":           { "label": "Time Tracking",            "desc": "Timers, time estimates and logged time on tasks." },
    "multiple_assignees":      { "label": "Multiple Assignees",       "desc": "Assign more than one person to a task." },
    "sprint_points":           { "label": "Sprint Points",            "desc": "Story points and sprint velocity." },
    "nested_subtasks":         { "label": "Nested Subtasks",          "desc": "Subtasks nested under a parent task." },
    "dependency_warning":      { "label": "Dependency Warning",       "desc": "Warn before completing a task with open blockers." },
    "reschedule_dependencies": { "label": "Reschedule Dependencies",  "desc": "Shift dependent tasks when a date changes." },
    "custom_task_ids":         { "label": "Custom Task IDs",          "desc": "Human-friendly task identifiers." },
    "email":                   { "label": "Email",                    "desc": "Outbound email notifications." }
  }
}
```

- [ ] Add the same keys to `apps/next-web/messages/id.json` with real Indonesian:

```json
"AppCenter": {
  "title": "Pusat Aplikasi",
  "toggle": "Alihkan {app}",
  "inheritedFrom": "Diwarisi dari {scope}",
  "apps": {
    "time_tracking":           { "label": "Pelacakan Waktu",           "desc": "Pengatur waktu, estimasi, dan waktu tercatat pada tugas." },
    "multiple_assignees":      { "label": "Beberapa Penerima Tugas",   "desc": "Tetapkan lebih dari satu orang ke sebuah tugas." },
    "sprint_points":           { "label": "Poin Sprint",               "desc": "Poin cerita dan kecepatan sprint." },
    "nested_subtasks":         { "label": "Subtugas Bersarang",        "desc": "Subtugas yang bersarang di bawah tugas induk." },
    "dependency_warning":      { "label": "Peringatan Ketergantungan", "desc": "Peringatkan sebelum menyelesaikan tugas dengan penghambat terbuka." },
    "reschedule_dependencies": { "label": "Jadwal Ulang Ketergantungan","desc": "Geser tugas dependen saat tanggal berubah." },
    "custom_task_ids":         { "label": "ID Tugas Khusus",           "desc": "Pengenal tugas yang mudah dibaca." },
    "email":                   { "label": "Email",                     "desc": "Notifikasi email keluar." }
  }
}
```

- [ ] Run: `npm test --workspace apps/next-web` (includes the `i18n/__tests__/messages.unit.test.ts` parity test). Expected: PASS — en/id key parity green; no empty values. Then `npm run build --workspace apps/next-web`. Expected: PASS (Next build clean).

- [ ] Commit:
```
git add apps/next-web/src/server/actions/apps.ts apps/next-web/src/components/AppCenter.tsx apps/next-web/src/components/AppCenter.module.css apps/next-web/src/lib/appGate.ts "apps/next-web/src/app/(app)/workspaces/[id]/settings/app-center-section.tsx" apps/next-web/messages/en.json apps/next-web/messages/id.json
git commit -m "feat(10a): App Center toggle grid + server actions + appGate helper + i18n (en+id)"
```

---

### Task 11: Wire the frontend feature gate (timer surface hides when off)

**Files:**
- Modify: the task detail panel / app shell that renders the timer surface (e.g. `apps/next-web/src/components/WorkLogSection.tsx` + the global timer widget mount, per Phase 8a)
- Modify: any board column / surface for a gated app that exists on-disk (sprint-points column, dependency-warning banner)

Steps:

- [ ] In the server component that renders a task panel (or the workspace shell), resolve the app set for the task's scope once via `loadAppToggles(workspaceId, 'list', listId)` and pass `apps` down to the surfaces. Gate the timer/worklog surface with `isAppOn(apps, 'time_tracking')`:

```tsx
import { isAppOn } from '@/lib/appGate';
// …
{isAppOn(apps, 'time_tracking') && <WorkLogSection taskId={taskId} /* … */ />}
```

- [ ] Apply the same `isAppOn(apps, '<key>')` guard to any other on-disk gated surface that exists (sprint-points column → `'sprint_points'`; dependency-warning banner → `'dependency_warning'`; multi-assignee picker → `'multiple_assignees'`). For surfaces whose features are not built yet (sprint points / custom task ids / email), **note inline** that they wrap in `isAppOn(...)` when they land.

- [ ] Run: `npm test --workspace apps/next-web` + `npm run build --workspace apps/next-web`. Expected: PASS — surfaces compile; default-on apps mean no visible change unless an override is set.

- [ ] Commit:
```
git add apps/next-web/src/components/WorkLogSection.tsx
git commit -m "feat(10a): hide gated feature surfaces (timer/worklog) when the app is off for the scope"
```

---

### Task 12: Playwright e2e (headline §4.5 flow)

**Files:**
- Create: `apps/next-web/e2e/app-toggles.spec.ts`
- Note: e2e runs against local Docker `ProjectFlow_Test` only (use the project's existing e2e env/setup, same as the views/realtime/time-tracking specs).

Steps:

- [ ] Write the e2e spec covering the BUILD_PLAN acceptance — toggle Time Tracking off for a Space → the timer/worklog surface disappears on a task beneath it; toggle on → it reappears. Follow the existing spec harness (login helper, seeded workspace/space/task) used by the views/time-tracking specs:

```ts
import { test, expect } from '@playwright/test';
import { loginAndSeedTask } from './helpers'; // existing helper used by other specs

test.describe('Phase 10a — app toggles', () => {
  test('disabling Time Tracking for a Space hides timers beneath it; enabling restores', async ({ page }) => {
    const { workspaceId, spaceId, taskUrl } = await loginAndSeedTask(page);

    // Baseline: time tracking ON → the worklog/timer surface is visible on the task.
    await page.goto(taskUrl);
    await expect(page.getByRole('button', { name: /log work/i })).toBeVisible();

    // Open the workspace App Center and turn Time Tracking OFF for the Space.
    await page.goto(`/workspaces/${workspaceId}/settings`);
    await page.getByRole('tab', { name: /apps/i }).click().catch(() => {});
    const ttRow = page.locator('[data-app="time_tracking"]');
    const ttSwitch = ttRow.getByRole('switch');
    if ((await ttSwitch.getAttribute('aria-checked')) === 'true') await ttSwitch.click();
    await expect(ttSwitch).toHaveAttribute('aria-checked', 'false');

    // Back on the task: the timer/worklog surface is now gone (feature-absent).
    await page.goto(taskUrl);
    await expect(page.getByRole('button', { name: /log work/i })).toHaveCount(0);

    // Turn it back ON → the surface reappears.
    await page.goto(`/workspaces/${workspaceId}/settings`);
    await page.getByRole('tab', { name: /apps/i }).click().catch(() => {});
    await page.locator('[data-app="time_tracking"]').getByRole('switch').click();
    await page.goto(taskUrl);
    await expect(page.getByRole('button', { name: /log work/i })).toBeVisible();
  });
});
```

> The e2e toggles at the **workspace** scope for simplicity (the resolver inherits down to the task). If `loginAndSeedTask` exposes a Space-settings App Center, prefer toggling at the Space scope to exercise the ancestry inheritance directly — adjust the navigation accordingly. Add `data-app="<key>"` to the App Center row (already in `AppCenter.tsx` Task 10) so the e2e targets it deterministically.

- [ ] Run: the project's e2e command for a single spec against `ProjectFlow_Test` (the same invocation the views/time-tracking specs use, e.g. `npx playwright test e2e/app-toggles.spec.ts`). Expected: PASS (1 test) — surface hides when off, reappears when on.

- [ ] Commit:
```
git add apps/next-web/e2e/app-toggles.spec.ts
git commit -m "test(10a): e2e — toggle Time Tracking off/on for a scope, timer surface hides/reappears"
```

---

### Task 13: Slice verification + DECISIONS.md + adversarial security pass

**Files:**
- Modify: `DECISIONS.md` (append a Phase 10a entry)

Steps:

- [ ] Run the full slice verification on local Docker `ProjectFlow_Test`:
  - `npm test --workspace apps/api` — Expected: PASS (existing suite + new `resolve.unit` + `requireApp.unit`).
  - `npm run test:integration --workspace apps/api` — Expected: PASS (existing + `apps.integration.test.ts`).
  - `npm test --workspace apps/next-web` — Expected: PASS (unit + `messages.unit` parity).
  - `npm run build --workspace apps/api` and `npm run build --workspace apps/next-web` — Expected: both PASS.
  - The app-toggles e2e — Expected: PASS.

- [ ] **Adversarial security review pass** (the blast radius of Phase 10 is authorization). Verify, with evidence:
  - A disabled app is a **404 feature-absent**, never a data leak: `requireApp` short-circuits BEFORE the handler runs, so no SP executes for a disabled feature.
  - The toggle write is **double-gated** (`app.manage` RBAC AND `FULL` on the object), fail-closed — a viewer/member cannot toggle (covered by the second integration test).
  - `requireApp` **composes** with `requirePermission` without bypassing it: an enabled app still requires the permission slug (an enabled feature you lack permission for still 403s).
  - The most-specific-wins resolver cannot be fooled by a foreign-workspace override: `usp_AppsEnabled_ListForScope` filters `ae.WorkspaceId = @WorkspaceId`, and the ancestry only contains nodes in the same Space/Workspace.
  - Unknown app keys fail closed (disabled), and the registry is the only key authority.

- [ ] Append a `DECISIONS.md` entry logging: the overrides-only `AppsEnabled` model + the workspace-root `ScopeId NULL` convention; the ancestry-walk reuse from `usp_ObjectAccess_Resolve` (Depth-ordered, most-specific-wins); the **404 feature-absent (`APP_DISABLED`) vs. 403** distinction and `requireApp` composing in FRONT of `requirePermission`; the per-request override-chain cache on the Hono context; the `app.manage` + `FULL`-on-object double guard for writes; the registry defaults + which apps are workspace-only; the dependency-warning/reschedule **service-layer** gates (route gates for assignees/nested-subtasks/dependency edges, but warning-suppression + reschedule-cascade gated inside the handler so transitions/date-updates still succeed); the overlap with the pre-existing `MultipleAssigneesDisabledError` Space setting; and which retrofits were **deferred inline** (sprint_points, custom_task_ids, email — features not on-disk). DB-execution-policy note: all DB work ran ONLY against local Docker `ProjectFlow_Test`.

- [ ] Commit:
```
git add DECISIONS.md
git commit -m "docs(10a): DECISIONS entry — apps toggles resolver/middleware/retrofits + security pass"
```

---

## Definition of Done

Per-slice DoD (spec §3) + BUILD_PLAN acceptance (spec §4.5):

- [ ] **BUILD_PLAN acceptance (§4.5):** Disabling the Time Tracking app hides timers everywhere beneath that scope — verified by the integration test (worklog endpoints 404 `APP_DISABLED` beneath a disabled Space, sibling intact, re-enable restores) AND the e2e (timer surface hides/reappears).
- [ ] Migration `0051_apps_enabled.sql` is idempotent, GO-batched, and **reversible** via `rollback/0051_apps_enabled.down.sql` (apply→rollback→re-apply verified clean); exact columns + `UNIQUE(WorkspaceId, ScopeType, ScopeId, AppKey)` per spec §4.1.
- [ ] SP-per-op (`usp_AppsEnabled_Set` MERGE/clear, `usp_AppsEnabled_ListForScope` ancestry override chain) reusing the `usp_ObjectAccess_Resolve` `Path LIKE` ancestry scan.
- [ ] The **default-on registry** (`app-registry.ts`) lists every spec app key with its default + overridable scopes; the **pure most-specific-wins resolver** is unit-tested (default → workspace → space → folder → list) + registry defaults.
- [ ] **`requireApp(appKey)`** (REST) + **`assertAppEnabled`** (GraphQL) return a **feature-absent 404 (`APP_DISABLED`)**, distinct from a 403, and **compose with** `requirePermission`/`requireWorkspacePermission` (placed in front); per-request cached like permissions; fail-closed on an unresolvable scope.
- [ ] Retrofitted onto Time Tracking (worklog routes), Multiple Assignees, Nested Subtasks, Dependency Warning, Reschedule Dependencies (each shown explicitly); Sprint Points / Custom Task IDs / Email noted inline as "apply when the feature lands."
- [ ] REST `/apps`, `/apps/:scope`, `PATCH /apps/:scope/:key` + the GraphQL mirror (`appToggles`/`setAppToggle`), both delegating to the one shared `AppService`; toggle writes guarded by `app.manage` **and** `FULL` on the object, fail-closed; writes publish a live refresh.
- [ ] App Center toggle grid with label/description/on-off/inheritance indicator; the resolved app set hides/shows feature surfaces (`isAppOn`); i18n `AppCenter` keys in **en.json + id.json** (real Indonesian), `messages.unit` parity green.
- [ ] `@projectflow/types` updated (`AppKey`, `AppScopeType`, `AppToggle`, `AppRegistryEntry`, `ResolvedApp`).
- [ ] Unit (resolver + middleware decision) + integration (feature-absent inheritance + FULL gating) + ≥1 Playwright e2e (headline) — all green.
- [ ] Adversarial security pass complete (404-not-leak, double-gated writes, composition, foreign-workspace isolation, fail-closed unknown keys).
- [ ] All DB work (migration, SP deploy, integration, e2e) ran **ONLY against local Docker `ProjectFlow_Test`** — never the prod-pointing `apps/api/.env`.
- [ ] `DECISIONS.md` entry logs the mechanism choices + deferred retrofits. **Stop for review/merge before Slice 10b.**

---

## Self-Review

**Spec coverage (§4):**
- §4.1 data model — `AppsEnabled(Id, WorkspaceId, ScopeType, ScopeId, AppKey, Enabled, UpdatedBy, CreatedAt, UpdatedAt, UNIQUE(WorkspaceId, ScopeType, ScopeId, AppKey))` reproduced exactly (Task 1), with the workspace-root `ScopeId NULL` convention spelled out. ✅
- §4.2 backend — registry in `apps/api/src/modules/apps/app-registry.ts` with key/label/default-enabled/overridable-scopes (Task 3); `usp_AppsEnabled_Set` + `usp_AppsEnabled_ListForScope` returning the ancestor override chain (Task 2); `app.service.isEnabled`/`resolveAll` most-specific-wins, per-request cached (Tasks 4–5); `requireApp(appKey)` REST + GraphQL `assertAppEnabled` (Tasks 5, 9); retrofits onto Time Tracking / Multiple Assignees / Sprint Points / Nested Subtasks / Dependency Warning + Reschedule / Custom Task IDs / Email — each applied or noted inline (Tasks 7–8); REST `/apps`, `/apps/:scope`, `PATCH /apps/:scope/:key` + GraphQL mirror (Tasks 6, 9). ✅
- §4.3 frontend — App Center grid with label/description/on-off/inheritance indicator + surface gating (Tasks 10–11). ✅
- §4.4 tests — unit (resolver most-specific-wins + registry defaults), integration (disable-at-Space feature-absent + sibling intact + re-enable), e2e (toggle off→timers gone, on→back) (Tasks 3, 7, 12). ✅
- §4.5 acceptance — disabling Time Tracking hides timers beneath that scope: integration + e2e (Tasks 7, 12; DoD). ✅
- §3 conventions — idempotent migration + rollback, `execSp`/`execSpOne`, Hono middleware composition + zod, Pothos in a `register*Graphql()` module wired into `schema.ts`, per-request context caching, realtime publish on toggle, i18n en+id parity, `app.manage` slug seeded + double-gated writes (`app.manage` + `FULL`), all gates fail-closed, DB only on `ProjectFlow_Test`. ✅

**Placeholder scan:** No "retrofit the others similarly" hand-waves — every retrofit (worklog routes, assignees, nested subtasks, dependency warning, reschedule) is shown with the exact gate; the three not-yet-built features (sprint_points, custom_task_ids, email) are explicitly noted inline as "apply when it lands" rather than fabricated. Full code given for the migration (exact columns + UNIQUE), both SPs, the registry (all 8 keys + defaults + override-scopes), the pure resolver, repository, service, `requireApp` middleware (REST) + `assertAppEnabled` (GraphQL) showing composition + the 404 feature-absent envelope, the `/apps` REST routes + GraphQL mirror, and the App Center grid component. The only deliberately conditional spots (`requireObjectAccess` null-skip behavior, `serverFetch` return shape, `transitionTask` force flag, the exact reschedule call site, the workspace-settings section pattern) are flagged with a "verify during implementation" note rather than left silent.

**Type / name consistency:** Uses the exact spec names — migration `0051`, table `AppsEnabled`, columns/`UNIQUE` verbatim, app-key strings (`time_tracking`, `multiple_assignees`, `sprint_points`, `nested_subtasks`, `dependency_warning`, `reschedule_dependencies`, `custom_task_ids`, `email`), and types `AppKey`/`AppToggle` (plus `AppScopeType`/`AppRegistryEntry`/`ResolvedApp`). `requireApp` returns `APP_DISABLED`/404 (feature-absent) consistently across REST + GraphQL. Real grounded paths/APIs: `usp_ObjectAccess_Resolve` ancestry scan, `requirePermission`/`loadPermissions` context cache, `requireObjectAccess('FULL', …)`, `ListRepository.getWorkspaceId`, `TaskRepository.getById`/`getWorkspaceId`, `register*Graphql()` wiring in `graphql/schema.ts`, server-action `serverFetch`/`ActionResult`/`requireSession`, and the `i18n/__tests__/messages.unit.test.ts` parity contract.
