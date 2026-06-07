# Phase 10 — Apps Toggles · Permissions Hardening · Sharing · Guests (Design)

**Date:** 2026-06-07
**Status:** Approved (design); spec under review
**BUILD_PLAN reference:** §Phase 10 ("Apps Toggles, Permissions Hardening, Sharing, Guests")
**Prerequisite:** Phases 1–9 complete. Builds directly on the **existing RBAC** (`0018_rbac.sql`:
`Permissions`/`Roles`/`RolePermissions`/`UserRoles`, `usp_UserPermissions_Get`,
`role.repository.getUserPermissionSlugs`), the **existing object-level ACL** (`0029`:
`ObjectPermissions` + `usp_ObjectAccess_Resolve`, most-specific-wins, `Projects.Visibility`
PUBLIC/PRIVATE), the REST `requirePermission` middleware
(`apps/api/src/shared/middleware/permissions.middleware.ts`) and the GraphQL `requireWorkspacePermission`
/`requireObjectLevel` (`apps/api/src/graphql/authz.ts`), the Phase 1 hierarchy ancestry walk, and the
Phase 3.5 notification/inbox (request-access notifications).

---

## 1. Overview & the real starting point

Phase 10 is **"three greenfield pillars on top of a mature permission core."** This is the inverse of a
normal phase: the hardest part (a correct, inheritance-resolved authorization system) **already
exists** and is production-grade; the new work is the modularity + external-access layer that sits on
top of it.

- 🟢 **RBAC ~80% built.** `0018_rbac.sql` defines `Permissions(Id, Resource, Action, Slug, Scope,
  Description)` (Scope `SYSTEM|WORKSPACE`, ~50 seeded slugs like `task.update`,
  `workspace.members.invite`, `admin.roles.manage`), seven **system roles** (`IsSystem=1`):
  SYSTEM-scoped `super-admin`/`user-admin`/`auditor` and WORKSPACE-scoped
  `workspace-owner`/`workspace-admin`/`workspace-member`/`workspace-viewer`; `RolePermissions(RoleId,
  PermissionId)`; `UserRoles(UserId, RoleId, WorkspaceId, AssignedBy, AssignedAt)` with a `WorkspaceKey`
  computed column. `role.repository.getUserPermissionSlugs(userId, workspaceId)` →
  `usp_UserPermissions_Get` → a per-request-cached `Set<string>`. The legacy `WorkspaceMembers.Role`
  column was backfilled then dropped (`0020`). **Missing for "hardening":** workspace-scoped **custom
  roles**, a per-object permission **editor UI**, and a verified **permission test matrix**.
- 🟢 **Object-level ACL ~60% built.** `0029` adds `ObjectPermissions(WorkspaceId, SubjectType
  (USER|ROLE), SubjectId, ObjectType (SPACE|FOLDER|LIST), ObjectId, Level (VIEW|COMMENT|EDIT|FULL))` +
  `usp_ObjectAccess_Resolve` — computes a membership **floor** (owner=`FULL`, member=`EDIT`), scans
  ancestors Space→Folder→object for the **most-specific** explicit grant, honors `Visibility='PRIVATE'`
  (non-member/non-owner without an explicit grant → no access), and returns `(Level, Found)`.
  `access.service.can()/resolveOrNull()` wrap it. **This is exactly the resolver guests + sharing
  need** — Phase 10 leans on it rather than replacing it.
- 🔴 **Apps / feature toggles = greenfield.** No `apps_enabled`/`AppsEnabled` table, no `appKey`
  concept, no gating. The Phase 8/9 specs reference "apps_enabled keys" purely as a *future* gate.
- 🔴 **Public sharing = greenfield.** `Projects.Visibility` (`PUBLIC|PRIVATE`) gates **member vs.
  non-member** only — there is **no** share token, no read-only public link, no unauthenticated render
  path, no request-access flow.
- 🔴 **Guests = greenfield.** `WorkspaceMembers` treats every member identically; there is no guest /
  limited-member distinction, no object-scoped membership, no org-email rule.

**Phase 10's real job:** add the **app-toggle** modularity layer (with inheritance + middleware
gating + an App Center), **finish** the permission system (custom roles + a per-object editor UI + a
test matrix), and build the **external-access** layer (public share links + request-access + guests/
limited-members) — all reusing the existing resolver, not reinventing it. Delivered as **four
sequential slices**, each independently verified and merged behind a review checkpoint, matching the
Phase 5/6/8/9 cadence.

| Slice | Feature | Greenfield? |
|------|---------|-------------|
| **10a** | **Apps / feature toggles** — `apps_enabled` + most-specific-wins resolver + `requireApp(appKey)` middleware + retrofit existing optional features + App Center UI | Greenfield |
| **10b** | **Permissions hardening** — workspace-scoped **custom roles** + per-object **permission editor UI** + role/permission-change auditing + a **permission test matrix** | Extends RBAC/ACL |
| **10c** | **Public share links** — scoped read-only token model + unauthenticated render routes (task/doc/dashboard/view/whiteboard) + **request-access** flow + sharing modals | Greenfield |
| **10d** | **Guests & limited members** — guest role semantics + org-email rule + guests-can't-join-Spaces + invite flow + private-tree invisibility | Greenfield |

### Locked product decisions (from brainstorming)
- **Ambition:** **full BUILD_PLAN parity** — all four pillars (toggles, hardening, sharing, guests),
  not acceptance-minimal.
- **Toggles resolve like statuses/fields:** a **most-specific-wins inheritance** over the hierarchy,
  reusing the same ancestry walk the ACL resolver already uses; gating is a `requireApp` middleware that
  **composes with** `requirePermission` (an app being off is a 404/feature-absent, distinct from a 403
  permission denial).
- **Reuse the resolver for guests + sharing:** guests get **no membership floor**, so the existing
  `usp_ObjectAccess_Resolve` already returns "no access" for everything not explicitly granted — guests
  need almost no new *resolution* logic, only new *grant* + *invite* paths and service-layer guards.
- **Sharing = a separate unauthenticated route group:** a scoped, signed, read-only token resolves to
  exactly one object at `VIEW` level and serves a **read-only projection** — never the workspace tree,
  never a write path.
- **Custom roles are workspace-scoped:** built by adding a `WorkspaceId` to `Roles` (NULL = the
  existing system roles); the existing role CRUD + `usp_UserPermissions_Get` resolution work unchanged.

---

## 2. Architecture — the three decisive mechanisms

### 2.1 App toggles — most-specific-wins over the hierarchy + a composing gate (10a)
An app is a **key** (`time_tracking`, `multiple_assignees`, `sprint_points`, `nested_subtasks`,
`dependency_warning`, `reschedule_dependencies`, `custom_task_ids`, `email`, …) declared in a
**default-on registry**. `AppsEnabled(ScopeType, ScopeId, AppKey, Enabled)` stores only **overrides**;
resolution walks the hierarchy ancestry (workspace → space → folder → list, the same walk
`usp_ObjectAccess_Resolve` performs) and the **most-specific** override wins, falling back to the
registry default.

- `app.service.isEnabled(appKey, scopeNode)` → resolved boolean (per-request cached like permissions).
- **`requireApp(appKey)`** is a middleware that **composes with** `requirePermission`:
  `requireApp('time_tracking')` + `requirePermission('worklog.create')`. The two are orthogonal — an
  app being disabled means "this feature does not exist here" (the timer UI is hidden, the endpoint
  returns feature-absent), while a permission denial means "you may not do this." This keeps the
  Phase 8/9 features (timers, sprint points, …) gateable **without touching their permission slugs**.
- The frontend resolves the effective app set for the current scope once and hides/show feature
  surfaces accordingly (the App Center writes overrides).

### 2.2 Public sharing — a scoped read-only token that bypasses membership, not scope (10c)
The decisive safety property: **a share token grants access to exactly one object at `VIEW`, and
nothing else.** A `ShareLinks(ObjectType, ObjectId, Token, Level, ExpiresAt, CreatedBy, RevokedAt)`
row is resolved by a **separate, unauthenticated route group** (`/share/:token` REST + a public Next
route) that:

1. looks up the token (not expired, not revoked),
2. resolves it to `(object, level=VIEW)` — **never** consulting workspace membership or the tree,
3. serves a **read-only projection** of that one object (a task, a doc, a dashboard, a saved view, a
   whiteboard) with all write affordances and all sibling/parent navigation stripped.

There is no JWT, no workspace context, and no path from the shared object back up the hierarchy. The
**request-access** flow is the inverse: an authenticated non-member viewing a private object can request
access, which creates a Phase 3.5 notification to the object's owners/admins, who grant via the 10b
editor (writing an `ObjectPermissions` row).

### 2.3 Guests — membership with no floor, access only by explicit grant (10d)
A guest is a `WorkspaceMembers` row assigned a **`workspace-guest`** role (a new system role with a
minimal slug set) plus an **explicit object-grant requirement**. The mechanism reuses the existing
resolver almost entirely:

- `usp_ObjectAccess_Resolve` already returns **no access** for a non-owner/non-member-floor subject on
  any object lacking an explicit `ObjectPermissions` grant. By giving guests **no membership floor**
  (the resolver's floor logic treats guest as below `member`), a guest sees **only** the specific
  objects explicitly shared with them — the Space tree is invisible by construction.
- **Service-layer guards** (not new resolution logic) enforce the BUILD_PLAN rules: a guest **cannot be
  added to a Space** (only granted specific List/Folder/task objects); an **org-email** user (email
  domain matches the workspace's verified domain) **cannot be invited as a guest** — they are promoted
  to `limited_member` instead.
- **Guest vs. limited member.** Both are seeded system roles with the **same no-floor + object-grant
  resolution** (they see only what is explicitly granted). They differ only in two service-layer
  rules: a **guest** is external (non-org-email) and **may not be added to a Space**; a
  **limited member** is internal (org-email) and **may** be granted Space-level objects. There is no
  resolver difference — only the invite/grant guards differ.
- A **guest invite** carries an email + a target object + a level; accepting it creates the
  `WorkspaceMembers` (guest) row + the `ObjectPermissions` grant atomically.

---

## 3. Cross-cutting conventions (every slice)

- **DB / SQL Server:** SP-per-op (`CREATE OR ALTER`, `SET NOCOUNT ON`, TRY/CATCH/TRANSACTION,
  `SELECT *` of affected rows) in `infra/sql/procedures/`, deployed by `scripts/db-deploy-sps.ts`.
- **Migrations** (assume Phases 6–9 land first — on-disk is currently `0037`; Phase 6 `0038–0039`,
  Phase 7 `0040–0042`, Phase 8 `0043–0046`, Phase 9 `0047–0050`): `0051_apps_enabled.sql`,
  `0052_custom_roles.sql` (`Roles.WorkspaceId` + workspace-role plumbing), `0053_share_links.sql`,
  `0054_guests.sql` (the `workspace-guest` system role seed + `GuestInvites`). Each idempotent
  (`IF NOT EXISTS` / `COL_LENGTH` guards), GO-batched, with a matching
  `infra/sql/migrations/rollback/00XX_*.down.sql`.
- **API dual surface:** Hono **REST** (primary; the SSR web client uses REST) + a **GraphQL** mirror,
  both delegating to one shared service per module (`apps`, `roles`/`access` [extended], `share`,
  `guests`). The public share route group (§2.2) is REST-only and **unauthenticated** by design.
- **Authorization:** new slugs seeded into `Permissions` — `app.manage`, `role.manage` (workspace
  custom roles), `object.permission.manage`, `share.create|revoke`, `guest.invite|manage`. Gates use
  the existing `requirePermission` (REST) + `requireWorkspacePermission`/`requireObjectLevel` (GraphQL),
  all fail-closed. **Sharing/guest grant endpoints require `FULL` on the object** (only someone who
  fully controls an object may share it or grant access).
- **Realtime:** toggle changes publish so feature surfaces appear/disappear live; share-link creation/
  revocation and access grants publish to the relevant object room; request-access creates a Phase 3.5
  inbox notification. No new live topics beyond the existing event path.
- **Shared types:** extend `packages/types/index.ts` (hand-written) — `AppKey`/`AppToggle`, `Role`
  (+ `workspaceId`), `ObjectPermission` editor shapes, `ShareLink`, `GuestInvite`, and the
  `workspace-guest`/`limited_member` role constants.
- **i18n:** all new UI strings (App Center, permission editor, sharing modals, guest invites) in
  `en.json` + `id.json` (real Indonesian); the `messages.unit` parity test must stay green.
- **DB execution policy:** migrations / SP-deploy / integration / e2e run **ONLY against local Docker
  `ProjectFlow_Test`** via explicit local DB env — **never** the prod-pointing `apps/api/.env`.
- **⚠️ Next.js:** per `apps/next-web/AGENTS.md`, this Next.js has breaking changes — **read the in-repo
  `node_modules/next/dist/docs/` before writing web code.** The unauthenticated `/share/:token` route
  must sit outside the protected `(app)` layout.
- **Definition of Done (per slice):** all acceptance boxes pass; migration reversible; unit +
  integration tests for new endpoints/behavior; ≥1 Playwright e2e for the headline flow;
  `@projectflow/types` updated; a `DECISIONS.md` entry logs deviations. Then **stop for review/merge**
  before the next slice.

---

## 4. Slice 10a — Apps / feature toggles

The modularity layer: lets a workspace/space turn features on or off, gating the optional Phase 5/8/9
features without touching their permissions.

### 4.1 Data model (`0051_apps_enabled.sql`)
```
AppsEnabled(Id PK, WorkspaceId, ScopeType NVARCHAR(12) NOT NULL,  -- 'workspace'|'space'|'folder'|'list'
     ScopeId UNIQUEIDENTIFIER NULL, AppKey NVARCHAR(40) NOT NULL,
     Enabled BIT NOT NULL, UpdatedBy, CreatedAt, UpdatedAt,
     UNIQUE (WorkspaceId, ScopeType, ScopeId, AppKey))            -- one override per (scope, app)
```
Only **overrides** are stored; the **default-on registry** of app keys lives in code
(`apps/api/src/modules/apps/app-registry.ts`).

### 4.2 Backend
- App-key registry (key, label, default-enabled, which scopes may override).
- SPs: `usp_AppsEnabled_Set`, `usp_AppsEnabled_ListForScope` (returns the ancestor override chain).
- `app.service.isEnabled(appKey, scopeNode)` — most-specific-wins over the ancestry walk (§2.1),
  per-request cached; `resolveAll(scopeNode)` for the frontend.
- **`requireApp(appKey)`** middleware (REST) + a GraphQL equivalent; retrofit it onto the optional
  features: Time Tracking (`worklog.*`, timers — Phase 8a), Multiple Assignees (Phase 2), Sprint Points
  (Phase 8c), Nested Subtasks (Phase 1 depth), Dependency Warning + Reschedule (Phase 5), Custom Task
  IDs, Email. Composes with the existing permission gate; disabled → feature-absent response.
- REST routes (`/apps`, `/apps/:scope`, `PATCH /apps/:scope/:key`) + GraphQL mirror.

### 4.3 Frontend
- **App Center**: per-workspace/space toggle grid (label, description, on/off, inheritance indicator);
  the resolved app set hides/show feature surfaces (timer widget, sprint-points column, dependency
  warnings, …) across the app.

### 4.4 Tests
- **Unit:** most-specific-wins resolution (default → workspace override → space override → list
  override); registry defaults.
- **Integration:** disabling Time Tracking at a Space makes timer endpoints feature-absent beneath it
  while a sibling Space keeps them; re-enabling restores.
- **e2e:** toggle Time Tracking off for a Space → timers disappear there; on → reappear.

### 4.5 Acceptance (BUILD_PLAN)
- [ ] Disabling the Time Tracking app hides timers everywhere beneath that scope.

---

## 5. Slice 10b — Permissions hardening (custom roles + editor UI + test matrix)

Finishes the already-strong permission core: makes it user-manageable and provably correct.

### 5.1 Data model (`0052_custom_roles.sql`)
- Add `Roles.WorkspaceId UNIQUEIDENTIFIER NULL` (NULL = the existing system/global roles; non-NULL =
  a workspace's custom role). The existing `RolePermissions`/`UserRoles`/`usp_UserPermissions_Get`
  resolution works unchanged — a custom role is just another row.
- No new ACL table: the per-object editor reads/writes the existing `ObjectPermissions` and resolves via
  `usp_ObjectAccess_Resolve`. Role/permission **changes are audited** via the existing `AuditLog`.

### 5.2 Backend
- Extend `role.service`: workspace-scoped custom-role CRUD (create from a permission-slug set, assign to
  users), guarded by `role.manage`; system roles remain immutable (`IsSystem=1`).
- Extend `access.service`: `setObjectPermission`/`removeObjectPermission` (write `ObjectPermissions`),
  `listObjectPermissions(object)` (the effective grant list for the editor), guarded by `FULL` on the
  object. Every role/grant mutation writes an `AuditLog` entry.
- REST + GraphQL mirror for both.

### 5.3 Frontend
- **Permission editor** (per object): the effective access list (members/roles → level), add/change/
  remove a grant, with a clear "inherited from <ancestor>" indicator (most-specific-wins made visible).
- **Custom role manager** (workspace settings): create/edit a role from permission slugs, assign to
  members.

### 5.4 Tests
- **Permission test matrix (the headline):** a parameterized matrix over {owner, admin, member, viewer,
  custom-role, guest} × {VIEW/COMMENT/EDIT/FULL grant at space/folder/list/none} × {PUBLIC/PRIVATE}
  asserting the resolved level — proving **most-specific-wins over the role floor** holds across the
  combinations.
- **Unit:** custom-role slug-set resolution; "inherited from" computation.
- **Integration:** create a custom role + assign → user gains exactly its slugs; set a List-level
  `EDIT` grant overriding a Space-level `VIEW`.
- **e2e:** create a custom role, grant a user `EDIT` on one List, verify they can edit there but not in a
  sibling List.

### 5.5 Acceptance (BUILD_PLAN)
- [ ] Most-specific permission wins over the role floor (verified with a test matrix).

---

## 6. Slice 10c — Public share links + request-access

### 6.1 Data model (`0053_share_links.sql`)
```
ShareLinks(Id PK, WorkspaceId, ObjectType NVARCHAR(16) NOT NULL,  -- 'task'|'doc'|'dashboard'|'view'|'whiteboard'
     ObjectId UNIQUEIDENTIFIER NOT NULL, Token NVARCHAR(64) NOT NULL UNIQUE,
     Level NVARCHAR(8) NOT NULL DEFAULT 'VIEW',     -- read-only in v1
     ExpiresAt DATETIME2 NULL, CreatedBy, CreatedAt, RevokedAt DATETIME2 NULL)
AccessRequests(Id PK, WorkspaceId, ObjectType, ObjectId, RequestedBy, Note NVARCHAR(500) NULL,
     Status NVARCHAR(12) NOT NULL DEFAULT 'pending',   -- 'pending'|'granted'|'denied'
     ResolvedBy NULL, ResolvedAt DATETIME2 NULL, CreatedAt)
```
The `Token` is a high-entropy random string (not a GUID); resolution is constant-time-safe.

### 6.2 Backend
- SPs: `usp_ShareLink_Create|Resolve|Revoke|ListForObject`, `usp_AccessRequest_Create|Resolve`.
- `share.service`: create (guarded by `FULL` on the object), revoke, and **`resolvePublic(token)`** →
  `(object projection, level)` or 404 (expired/revoked/missing). The projection is a **read-only,
  navigation-stripped** view of exactly one object.
- A **separate unauthenticated route group** `/share/:token` (REST) — no `authMiddleware`, no workspace
  context — returning the projection; a matching **public Next route outside `(app)`**.
- `access.service.requestAccess(object)` → `AccessRequests` row + a Phase 3.5 notification to the
  object's owners/admins; granting routes through the 10b `setObjectPermission`.

### 6.3 Frontend
- **Sharing modal** (per task/doc/dashboard/view/whiteboard): toggle a public link, copy URL, set
  expiry, revoke; plus the private-share path (invite a member/role at a level → 10b grant).
- **Public read-only renderer** for each object type (no app chrome, no sibling nav).
- **Request-access** UI for an authenticated non-member hitting a private object; owners resolve from
  the inbox.

### 6.4 Tests
- **Unit:** token resolution (expired/revoked/valid); projection strips writes + navigation.
- **Integration:** a public link serves exactly the one object with no auth and no tree access; a
  revoked/expired token 404s; request-access creates a notification; granting it writes an
  `ObjectPermissions` row.
- **e2e:** create a public share link, open it in an unauthenticated context, see read-only content and
  no way to reach siblings/parent.

### 6.5 Acceptance (BUILD_PLAN)
- [ ] A public share link exposes only the shared object, read-only, no auth.

---

## 7. Slice 10d — Guests & limited members

### 7.1 Data model (`0054_guests.sql`)
- Seed **two** system roles (`IsSystem=1`, WORKSPACE scope, minimal slugs — essentially `*.read` on
  explicitly granted objects only) into `Roles`/`RolePermissions`: **`workspace-guest`** (external) and
  **`workspace-limited-member`** (internal / org-email). They share the same no-floor + object-grant
  resolution and differ only in the invite/grant guards (§2.3).
- `GuestInvites(Id PK, WorkspaceId, Email, ObjectType, ObjectId, Level, Token NVARCHAR(64) UNIQUE,
   Status NVARCHAR(12) DEFAULT 'pending', InvitedBy, ExpiresAt, CreatedAt, AcceptedAt)`.
- `WorkspaceMembers` gains `IsGuest BIT NOT NULL DEFAULT 0` (denormalized for fast tree-visibility
  filtering); the authoritative role is still the `workspace-guest` assignment in `UserRoles`.

### 7.2 Backend
- Adjust the **floor** logic in `usp_ObjectAccess_Resolve`: a guest membership contributes **no floor**
  (below `member`), so a guest resolves to access **only** where an explicit `ObjectPermissions` grant
  exists — the Space tree is invisible by construction (§2.3).
- `guest.service`: `invite` (org-email guard → promote to `limited_member` if the email matches the
  workspace's verified domain; reject adding a guest at `Space` scope — only Folder/List/task), `accept`
  (atomic: create the guest `WorkspaceMembers` row + the `ObjectPermissions` grant), `list`, `revoke`.
- Tree/listing endpoints filter out non-granted nodes for guests (defense-in-depth alongside the
  resolver).
- REST + GraphQL mirror.

### 7.3 Frontend
- **Guest & member management** (workspace settings): invite a guest to a specific object at a level;
  list guests with their granted objects; revoke. The Space-tree sidebar shows a guest only their
  granted objects.

### 7.4 Tests
- **Unit:** org-email → limited-member promotion; reject-guest-at-Space guard; guest floor = none.
- **Integration:** a guest sees only explicitly-shared items and 403/404s on the rest; cannot enumerate
  the Space tree; an org-email invite becomes a limited member, not a guest.
- **e2e:** invite a guest to one List, accept, confirm they see that List only and cannot navigate to the
  Space or siblings.

### 7.5 Acceptance (BUILD_PLAN)
- [ ] Guest sees only explicitly shared items; cannot see the Space tree.

---

## 8. Execution model

Each slice via **subagent-driven-development** (a fresh implementer subagent per task + a two-stage
spec/quality review per task, matching the Phase 5/6/8/9 flow). **Authorization is the blast radius of
this phase** — every slice gets an explicit adversarial security review pass (can a toggle/share/guest
path leak data across the membership boundary?) before merge. After a slice:
1. Verify on **local Docker `ProjectFlow_Test`**: API unit + integration, web unit + i18n parity,
   `npm run build`, and the slice's e2e headline flow.
2. Record decisions/deviations in `DECISIONS.md`.
3. **Stop for review / merge** before the next slice.

Order: **10a → 10b → 10c → 10d.** 10a (toggles) is independent and lowest-risk, so it goes first. 10b
(custom roles + the object-permission editor) provides the **grant primitive** (`setObjectPermission`)
that 10c (request-access grants) and 10d (guest grants) both call, so it precedes them. 10c (sharing)
and 10d (guests) both depend on 10b's editor; 10c is unauthenticated-external while 10d is
authenticated-scoped, so they are independent of each other and could swap.

---

## 9. Consolidated deferrals (logged for `DECISIONS.md`)
1. **Billing / plan-gating / metering:** Phase 10 builds the **toggles** (feature on/off by scope) but
   does **not** meter usage or charge — per BUILD_PLAN §8, billing is out of scope v1. The
   `AppsEnabled` model is the substrate a later plan-gate would read.
2. **Editable share links / public write:** v1 share links are **read-only `VIEW`** only; comment-level
   or editable public links are a follow-up (the `Level` column is in place for it).
3. **SSO / SAML / SCIM:** enterprise identity (org-managed guests, directory sync) → post-v1
   (BUILD_PLAN §8). The org-email rule here is a lightweight domain-match, not directory-backed.
4. **Per-task / per-comment object permissions:** the ACL stays at the **hierarchy node** level
   (Space/Folder/List) as today; guests/shares target tasks/docs via their containing node or a
   share token. Finer-grained per-task ACL rows are a follow-up if demanded.
5. **Email-channel invites:** guest/access-request **emails** depend on the same SMTP infra deferred in
   Phase 9; until then invites surface via the in-app inbox + a copyable invite link. Wiring email →
   **Phase 12**.
6. **Custom-role permission UI depth:** 10b ships slug-set role building; a richer grouped/templated
   permission picker is a polish follow-up.
