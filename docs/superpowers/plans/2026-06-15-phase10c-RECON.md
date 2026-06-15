# Phase 10c (Share Links) — Reconciliation notes (the plan predates phases 6–10b)

The plan `2026-06-07-phase10c-share-links.md` assumes migration 0037 + several unbuilt
modules. Reality (verified 2026-06-15 against the merged 10b tip `e0b602f`): on-disk DB
is at **0060 / 377 SP files**. Apply these corrections when implementing.

## Migration / SP
- Plan migration **`0053` → renumber to `0061_share_links.sql`** (+ `rollback/0061_share_links.down.sql`).
- Idempotent GO-batched style + perm-slug seed pattern: copy `0060_custom_roles.sql`.
  Role slugs are **`'workspace-owner'` / `'workspace-admin'`**. Seed `share.create` + `share.revoke`.
- New SPs (9, not 6): the plan's `usp_ShareLink_Create|Resolve|Revoke|ListForObject`,
  `usp_AccessRequest_Create|Resolve`, **PLUS** (added for authorize-then-mutate + fan-out):
  - `usp_ShareLink_GetById` — read a link (objectType/objectId) WITHOUT mutating, for the FULL gate before revoke.
  - `usp_AccessRequest_GetById` — read a request WITHOUT mutating, for the FULL gate before resolve.
  - `usp_Workspace_ListOwnerAdminIds` — `SELECT DISTINCT ur.UserId FROM UserRoles ur JOIN Roles r ON r.Id=ur.RoleId WHERE ur.WorkspaceId=@WorkspaceId AND r.Slug IN ('workspace-owner','workspace-admin')`.
  - Final SP count → ~386.

## API seams (verified signatures)
- `accessService.setObjectPermission(input)` — **OBJECT param**:
  `{ workspaceId, subjectType:'USER'|'ROLE', subjectId, objectType:HierarchyNodeType, objectId, level:ObjectPermissionLevel, actorId, actorEmail? }` → `Promise<void>`.
  (Plan's positional call is WRONG. Must pass `actorId: resolverId`.)
- `accessService.can(userId, objectType:HierarchyNodeType, objectId, min:ObjectPermissionLevel) → Promise<boolean>`.
- `requirePermission(slug|slug[], { resolveWorkspace?(c):Promise<string|null> })`; resolved ws id read via `c.get('resolvedWorkspaceId')`.
- `requireObjectAccess(min, resolveObject(c):{type,id}|null)` lives in `modules/access/access.middleware.ts`.
- Authed user in a Hono handler: `c.get('user')` → `.userId`.
- `notificationService.notify({ recipientIds:string[], actorId, type:string, payload:Record<string,any> }) → Promise<void>`.
  Type is free-form (NVARCHAR(50), no DB CHECK). New types `ACCESS_REQUESTED`/`ACCESS_GRANTED` only need
  web `components/notifications/notification-meta.ts` TYPE_META entries + Inbox i18n.
- `taskRepo.getById(id) → Task|null` **mapped camelCase** (`.listId`, `.title`, `.description`, `.status`, `.priority`, `.dueDate`). `taskRepo.getWorkspaceId(id) → string|null`.
- `viewRepo.getById(id) → SavedView|null` mapped camelCase (`.name`, `.type`, `.config` ALREADY JSON-parsed object). `viewRepo.getWorkspaceId(id)`.
- ⇒ **projection builders read camelCase** (make them casing-tolerant `row.title ?? row.Title`); `buildViewProjection` must NOT JSON.parse (config already parsed); unit tests feed camelCase (the real path).
- `execSpOne<T>(sp, params) → first recordset rows[]`; `execSp → recordset[]`.

## server.ts
- `new Hono().basePath('/api/v1')`. Public groups mounted around the authMiddleware block: `/auth`, `/avatars` (GET public), `/forms` (`/forms/public/*` unauthed), `/webhooks`.
- Mount **`/public/share` (publicShareRoutes) BEFORE the authMiddleware block** (no auth, no audit).
- Mount `/share` + `/access` AFTER, with `authMiddleware` (+ `auditMiddleware`). `/public/share` does NOT match `app.use('/share/*', authMiddleware)`.

## Frontend
- `serverFetchBody<T>(path, init)` → raw envelope (use for `{link}`/`{links}`/`{request}`). `serverFetch` unwraps `{data}`.
- i18n: **`apps/next-web/messages/en.json` + `id.json`** (CRLF). next-intl config: `src/i18n/request.ts` imports `../../messages/${locale}.json`. Run `npm test --workspace apps/next-web` to catch parity.
- Next app router: `(app)` group + public siblings `login/register/oauth/forms`. Public route → `app/share/[token]/page.tsx` (sibling of `(app)`). **`params` is a Promise — `await params`.** Model on `app/forms/public/[slug]/page.tsx` + its `@/server/public/forms` helper → add `@/server/public/share` plain-fetch helper (no cookie) hitting `${API}/api/v1/public/share/:token`.

## GraphQL
- `schema.ts`: import + call `registerShareGraphql()` alongside the other `register*Graphql()` (after `registerPermissionsGraphql()`). Template = `graphql/permissions.schema.ts` (10b).
- `authz.ts`: `requireWorkspacePermission(ctx, workspaceId, slugs) → Promise<string>`; `notFound(msg?)` throws NOT_FOUND. `ctx.user.userId`.

## Tests
- `createTestUser() → { user:{Id,Email,Name}, accessToken, ... }` (id = `.user.Id` PascalCase).
- `createTestWorkspace(token) → {Id,Name,Slug}`; `createTestProject(wsId, token, {...}) → {Id,...}`.
- **`POST /lists` and `POST /tasks` both return `{data}` PascalCase** (plan's `{task}` is wrong → use `(json).data` + read `.Id`/`.id`).
- `truncate.ts` `TRUNCATION_ORDER`: add `ShareLinks` + `AccessRequests` before `Workspaces`/`Users` (FK both).

## Scope decision
- v1 real projections = **task + view**. doc/dashboard/whiteboard modules now exist but stay **graceful stubs** (resolvePublic → 404, renderer → "type not available") — documented deferral in DECISIONS (matches the plan's task-focused acceptance §6.5 and the 9e Doc-view precedent). Wiring them is a follow-up.
- **Authorize-THEN-mutate** on revoke + access-request-resolve (read object via GetById → assert FULL → mutate). Integration test must prove a non-FULL caller gets 403 with NO ObjectPermissions/RevokedAt write.
