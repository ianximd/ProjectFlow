# Phase 10d (Guests) — Reconciliation notes

The plan `2026-06-07-phase10d-guests.md` predates phases 6a–10c. Verified seams against on-disk
reality (Explore reconciliation + controller spot-checks). Corrections applied during execution:

## Migration / DB
1. **Migration number `0054` → `0062_guests.sql`** (on-disk tip is 0061; local DB at 0061/386 SPs).
   Rollback `rollback/0062_guests.down.sql`; `MigrationHistory.FileName='0062_guests.sql'`. The
   forward-only runner inserts the history row itself — migration body must NOT; rollback deletes it.
2. **`usp_ObjectAccess_Resolve.sql` current body is byte-identical to the plan's "before" snapshot**
   (10b did NOT touch it). The plan's modified version (add `@IsGuest` + `WHEN @IsGuest=1 THEN NULL`
   floor branch above the member branch) applies verbatim and correctly. Output cols `Level`,`Found`.
   The role-join filter `(ur.WorkspaceId=@WorkspaceId OR ur.WorkspaceId IS NULL)` is present (custom
   roles from 10b ride through unchanged).
3. **System-role + RolePermissions seeds must join `r.WorkspaceId IS NULL`** (0061 convention, post-10b
   filtered-unique `UQ_Roles_Slug_System`). Roles INSERT omits WorkspaceId (→ NULL = system). Slugs the
   RolePermissions seed references (`task.read`, `comment.create`, `comment.update.own`,
   `comment.delete.own`) all exist (0018) — seed is not a silent no-op.
4. **`WorkspaceMembers`** has `Id`,`Role NVARCHAR(20) DEFAULT 'MEMBER'`,`JoinedAt` — Accept SP INSERT
   `(Id,WorkspaceId,UserId,IsGuest)` lets Role/JoinedAt default. `UQ_WorkspaceMember (WorkspaceId,UserId)`.
5. **`ObjectPermissions`** unique key `UQ_ObjPerm (SubjectType,SubjectId,ObjectType,ObjectId)`; cols
   WorkspaceId,SubjectType,SubjectId,ObjectType,ObjectId,Level (no GrantedBy col). `UserRoles` PK
   (UserId,RoleId,WorkspaceKey) — INSERT (UserId,RoleId,WorkspaceId).
6. **`truncate.ts`** — add `'GuestInvites'` to TRUNCATION_ORDER before Workspaces/Users (near
   ShareLinks/AccessRequests). WorkspaceMembers already truncated; IsGuest col needs no change.
7. **Workspace VerifiedDomain** is greenfield. Added: column (migration), new SP
   `usp_Workspace_GetVerifiedDomain`, repo `getVerifiedDomain`, and `@VerifiedDomain` param on
   `usp_Workspace_Update` + `workspaceService.update` + the PATCH `/workspaces/:id` handler.

## API seams
8. **`access.service.setObjectPermission` ALREADY EXISTS** (object-param, 10b):
   `setObjectPermission({workspaceId,subjectType,subjectId,objectType,objectId,level,actorId,actorEmail?})`.
   DO NOT add the plan's positional duplicate (compile clash). Accept is atomic in-SP and needs no
   service grant call. **Only add `filterVisibleNodes`** to access.service.
9. `accessService.resolveOrNull(userId,type,id) → {level,found}` (lowercase). `can(userId,type,id,min)→bool`.
   `AccessRepository.set(wsId,subjectType,subjectId,objType,objId,level,grantedBy?)`.
10. **`execSp` returns `IRecordSet<T>[]` directly** (NOT `{recordsets}`). Multi-set repo reads `sets[0]`,
    `sets[1]`. `execSpOne` returns the first recordset (array); `rows[0]` is the first row.
11. **No `users` module / no `UserRepository`.** Use `AuthRepository.getUserById(userId)` →
    PascalCase row (`usp_User_GetById` SELECTs `Id,Email,Name,...`). The `User` TS type is camelCase
    but the row is PascalCase → read `(me as any).Email` (casing landmine).
12. `requireObjectAccess('FULL',(c)=>({type,id}))`; `requirePermission('guest.manage',{workspaceParam:'workspaceId'})`;
    handler user via `(c as any).get('user').userId`. GraphQL: `requireObjectLevel(ctx,type,id,min)`,
    `requireWorkspacePermission(ctx,wsId,slugs)`, `notFound(msg)`, `ctx.user.userId`; `'Date'` scalar exists;
    `registerGuestGraphql()` called from `graphql/schema.ts` like the other `register*Graphql()`.
13. POST /lists,/folders,/projects → `{data:{...PascalCase Id...}}`. GET /lists & /folders gated
    `requireObjectAccess('VIEW',{type:'SPACE',id:spaceId})`; GET /projects gated by `workspaceId` only.
    `/lists/:id/effective-statuses` exists, VIEW-gated → use for 200/403 probes. Splice
    `filterVisibleNodes` into each GET handler (casing-tolerant `id ?? Id`).

## Frontend / tests
14. **i18n at `apps/next-web/messages/{en,id}.json`** (NOT src/messages). `messages.unit` parity test.
15. Server actions: `requireSession`, `serverFetch` (unwraps `{data}`), `serverFetchBody` (raw),
    `toActionError`, `ActionResult`. **Session token is in COOKIES, not localStorage** → e2e direct-API
    probe uses a Playwright request context logged in as the guest (Bearer), not `localStorage`.
16. Test factories: `createTestUser → {user:{Id,Email,Name}, accessToken}` (read `x.user.Id`,
    `x.user.Email`, `x.accessToken` — NOT `x.id`/`x.email`); `createTestWorkspace(token)→{Id}`;
    `createTestProject(wsId,token,{name,key})→{Id,WorkspaceId}`. `request(path,{method,token,json})`,
    `json(res,expectStatus)`.
