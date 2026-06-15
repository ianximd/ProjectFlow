# Phase 10b — Reconciliation notes (plan written pre-6→10a)

The plan `2026-06-07-phase10b-permissions-hardening.md` predates phases 6–10a. These are the **verified deltas** between the plan and the current codebase. Apply these; otherwise the plan's SQL/TS is sound.

## Migration numbering
- On-disk tip: `0059_app_perms`. Local DB at 0059, 372 SP files.
- **Renumber:** plan's `0052_custom_roles` → **`0060_custom_roles.sql`** + `rollback/0060_custom_roles.down.sql`. After this slice DB = 0060.

## SQL (plan SQL correct against current schema — only the number changes)
- `dbo.Roles` (0018): `Id, Name, Slug NVARCHAR(100) NOT NULL UNIQUE` (inline unique CONSTRAINT, autogen name → use the plan's dynamic-drop), `Description, Scope, IsSystem, CreatedAt, UpdatedAt`. **No `WorkspaceId` yet.** Index `IX_Roles_Scope`. 7 system roles (super-admin/user-admin/auditor SYSTEM; workspace-owner/admin/member/viewer WORKSPACE).
- `dbo.ObjectPermissions` (0029): `Id PK, WorkspaceId(FK Workspaces), SubjectType, SubjectId, ObjectType, ObjectId, Level, CreatedAt`; `UQ_ObjPerm UNIQUE(SubjectType,SubjectId,ObjectType,ObjectId)`. **No FK on SubjectId** (polymorphic USER/ROLE).
- `usp_ObjectAccess_Resolve` returns `Level NVARCHAR(8)` + `Found BIT`. Floor = owner→FULL, member→EDIT, else NULL (**role-independent** — every member incl. viewer gets EDIT floor). Explicit grant most-specific (Depth DESC, USER before ROLE); PRIVATE denies only non-member/non-owner with no explicit. Returns `COALESCE(@Explicit,@Floor)`. **The matrix FLOOR table + `expected()` are correct against this.**
- Projects soft-delete = `Status <> 'DELETED'`; Folders/Lists have `Path/SpaceId/WorkspaceId/DeletedAt`. ListForObject ancestry SQL is correct.
- Existing role SPs `usp_Role_Create/Update/List/GetById` match the plan's "before" — apply the plan's edits + add `WorkspaceId`. **Also add `WorkspaceId` to `usp_Role_GetBySlug` SELECT** (it feeds `mapRole`, which now reads `r.WorkspaceId`).
- `usp_ObjectPermission_Set` matches plan "before"; add `@GrantedBy=NULL` + validation guards. `usp_ObjectPermission_Unset` exists (silent). Add sibling `usp_ObjectPermission_Remove` (@@ROWCOUNT) + `usp_ObjectPermission_ListForObject` per plan.
- **Visibility:** lives in `usp_Project_Update`. For the matrix, add a tiny **`usp_Project_SetVisibility`** SP (`UPDATE dbo.Projects SET Visibility=@Visibility WHERE Id=@Id`) and deploy it (replaces the plan's `sp_executesql` stub). Deploy with the Task 3 SP batch.
- **Node→workspace:** no existing `usp_Hierarchy_NodeWorkspace`/`getWorkspaceIdForNode`. Create per plan.

## API
- `role.repository.ts`: `mapRole` lacks `workspaceId` → add `workspaceId: r.WorkspaceId ?? null`. `createRole` add `workspaceId?` param. Add `listRolesForWorkspace` (uses existing `mapRoleWithCounts`). `execSp/execSpOne` from `'../../shared/lib/sqlClient.js'`.
- `role.service.ts` = **OBJECT LITERAL** `export const roleService = {...}`; `slugify` in-file. Add workspace-role members to the literal (self-refs `roleService.x` resolve at call time). Import `writeAccessAudit` from `'../access/access.audit.js'`.
- `access.repository.ts`: `AccessRepository` class (no singleton export). Add `grantedBy` to `set`, add `remove` (count), `listForObject`. Import `ObjectPermissionGrant`.
- `access.service.ts`: extend in place — **KEEP** `LEVEL_ORDER`, `can`, `resolveOrNull`, `export const accessService` (access.middleware + graphql/authz import them). Add `listObjectPermissions/setObjectPermission/removeObjectPermission`.
- `access.audit.ts`: new. `AdminRepository.createAuditEntry(CreateAuditInput{workspaceId?,userId,userEmail?,action,resource,resourceId?,oldValues?:Record<string,unknown>|null,newValues?,ipAddress?,userAgent?})` from `'../admin/admin.repository.js'`. Cast `oldValues/newValues` (`unknown`) `as Record<string,unknown>` when forwarding.
- `access.middleware.ts`: `requireObjectAccess(min, resolveObject)` extractor returns `{type,id}|null|Promise`. Matches plan.
- `requirePermission(slug|slugs, {workspaceParam|workspaceId|resolveWorkspace|ownerOnly|ownerFallback})` from `'../../shared/middleware/permissions.middleware.js'`; supports `{workspaceParam:'workspaceId'}`. Freeze guard fires on writes (fine for ACTIVE ws). `loadPermissions` also exported there.
- `role.routes.ts`: router `roleRoutes`, mounted at `/admin` via `adminRoutes.route('/', roleRoutes)` (admin.routes.ts:37). **No blanket admin gate.** In-file helpers: `getActorId, notFound, badRequest, conflict, mapSqlError`. Add `actorEmail(c)`. Add the 6 workspace-role endpoints `/workspaces/:workspaceId/roles[...]` gated `requirePermission('role.manage',{workspaceParam:'workspaceId'})`.
  - **ADD `GET /admin/workspaces/:workspaceId/permissions`** (gated `role.manage`, workspaceParam) → `roleService.listPermissions('WORKSPACE')`. Needed because `/admin/permissions` is `admin.roles.manage`/super-admin-gated — a workspace owner managing roles must read the WORKSPACE catalog.
- `access.routes.ts`: new; `app.route('/access', accessRoutes)` in server.ts. `requireObjectAccess('FULL', obj)` + `hierarchyRepo.getWorkspaceIdForNode`. Actor = `c.get('user').userId`.
- GraphQL `authz.ts`: `requireWorkspacePermission(ctx,wsId,slugs)`, `requireObjectLevel(ctx,type,id,min)`, `notFound(msg?)`, `requireAuth`. `forbidden` is **private** → permissions.schema.ts defines its own `forbid`. `ctx.user.userId`; cast `as any` for `.email`. `schema.ts`: add `import { registerPermissionsGraphql } from './permissions.schema.js'` + call near other `register*Graphql()`. **Read a recent schema (e.g. `graphql/goal.schema.ts`/`dashboard.schema.ts`/`worklog.schema.ts`) for the exact Pothos helper names** (`builder.objectRef`, `t.exposeString/exposeInt/boolean/string/field`, `t.arg.string/stringList`, `builder.queryFields/mutationFields`).

## Frontend
- i18n: **`apps/next-web/messages/en.json` + `id.json`** (NOT `src/messages`). Parity test exists; real Indonesian required.
- e2e: **repo-root `e2e/`** → `e2e/permissions-hardening.spec.ts`. `playwright.config.ts` at repo root.
- Server actions: `requireSession` from `'../session'`, `serverFetch` from `'../api'` (unwraps `data`; pass `JSON.stringify` bodies), `toActionError` from `'./error'`, `ActionResult` from `'./result'`, `revalidatePath` from `'next/cache'`. Mirror `admin-roles.ts`.
- `loadPermissions()` (admin-roles) is super-admin-gated → add `loadWorkspacePermissions(workspaceId)` hitting the new `GET /admin/workspaces/:workspaceId/permissions`; `CustomRoleManager` uses it (not `loadPermissions`).
- `notifyActionError(res:{error,code?,status?})` from `'@/lib/apiErrorToast'`. `ActionResult` error carries `.error`.
- `WorkspaceSettingsView` (`app/(app)/workspaces/[id]/settings/workspace-settings-view.tsx`) is a **client** component receiving `workspace: WorkspaceDetail` (`workspace.id`); already mounts `<AppCenter>`. Mount `<CustomRoleManager workspaceId={workspace.id} />` here.
- **No `/lists/[listId]/settings` route** (only `[listId]/page.tsx`). Create a minimal `app/(app)/lists/[listId]/settings/page.tsx` rendering `<ObjectPermissionEditor objectType="LIST" objectId={listId} />`, and give the editor a minimal **add-subject affordance** (user id/email input + level select + Add). e2e may grant via API (project convention = prefer API-driven) but the editor must be mounted/usable.
- Types exist: `ObjectPermissionLevel`(L79), `HierarchyNodeType`(L80), `RoleScope`, `Permission`, `Role`(L1142), `RoleWithCounts`, `RoleWithPermissions`, `RoleMember`. Add `workspaceId: string|null` to `Role`; add `ObjectPermissionSubjectType/ObjectPermissionGrant/SetObjectPermissionInput/CreateWorkspaceRoleInput` after `RoleMember`.

## Test harness — CRITICAL shape drift
- `createTestUser(opts)` → `{ user:{Id,Email,Name}, accessToken, refreshToken, password }`. **Plan's `owner.id` is WRONG → use `owner.user.Id`; email = `owner.user.Email`.** `accessToken` correct. `createTestUser({systemRole:'super-admin'})` available.
- `createTestWorkspace(token,name?)` → `{Id,Name,Slug}` (`ws.Id`). `createTestProject(wsId,token,{name?,key?})` → `{Id,WorkspaceId,Key,Name}` (`space.Id`; type KANBAN). `createTestTask(projectId,wsId,token,{...})` → `{Id,...}`.
- Imports: `{request,json}` from `'../../../__tests__/setup/testServer.js'`; `{truncateAll}` from `'../../../__tests__/fixtures/truncate.js'`; factories from `'../../../__tests__/fixtures/factories.js'`; `{closePool}` from `'../../../shared/lib/db.js'`. (roles/__tests__ and access/__tests__ are both 3 levels deep → `../../../`.)
- Task 6 REST sub-test: **don't** call `/admin/permissions` (super-admin gated). Use `roleService.listPermissions('WORKSPACE')` directly or the new `/admin/workspaces/:wsId/permissions`.
- Matrix member-add: `POST /workspaces/:id/members {userId, role}` → `workspaceService.addMember(wsId,userId,role)`. Role string only affects RBAC slugs; **membership alone drives the EDIT floor**. Verify `addMember`'s accepted role values; for the matrix just make admin/member/viewer/custom members (→EDIT floor), guest stays non-member.
- **truncate.ts FK-547 LANDMINE:** `truncateAll` preserves the `Roles` catalog, but custom roles FK `Workspaces`. Once a test creates a custom role, the next `truncateAll`'s `DELETE FROM Workspaces` fails `FK_Roles_Workspace`. **Add a guarded pre-step** (in the `for (const stmt of [...])` block, runs before the loop) deleting custom roles + their assignments:
  ```ts
  "DELETE FROM dbo.UserRoles",  // assignments (catalog Roles stay; re-deleted harmlessly in the loop)
  "IF COL_LENGTH('dbo.Roles','WorkspaceId') IS NOT NULL DELETE FROM dbo.Roles WHERE WorkspaceId IS NOT NULL",
  ```
  (RolePermissions cascade on the custom-role delete; ObjectPermissions has no FK to Roles and is wiped in the loop.) Patch in Task 6; Tasks 7/8 depend on it.
