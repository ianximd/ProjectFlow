# Changelog

All notable changes to ProjectFlow are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased] — Phase 5 + Phase 6

### Added

#### Phase 6 — Post-launch (Week 33 — Workspace soft-delete + Task time-of-day deadlines)
- **Migration `0023_workspace_deletedat.sql`** — adds `Workspaces.DeletedAt DATETIME2 NULL` plus a filtered non-clustered index `IX_Workspaces_DeletedAt … WHERE DeletedAt IS NULL` to keep "list active workspaces" cheap. Idempotent
- `usp_Workspace_Delete` now stamps `DeletedAt = SYSUTCDATETIME()` instead of issuing a physical `DELETE`, mirroring the soft-delete pattern Users and Projects already use. `usp_Workspace_GetById` and `usp_Workspace_List` filter `DeletedAt IS NULL` so soft-deleted workspaces disappear from the API surface
- **Migration `0024_task_duedate_datetime.sql`** — widens `Tasks.DueDate` from `DATE` to `DATETIME2`. Existing day-only values implicitly become same-day-at-00:00:00, so reports / filters that compare against `CAST(GETDATE() AS DATE)` keep returning the same rows. The three covering indexes from `0016_perf_indexes.sql` that carry `DueDate` in their `INCLUDE` list (`IX_Task_ProjectId_Status`, `IX_Task_SprintId_Status`, `IX_Task_ReporterId_Status`) are dropped and recreated around the `ALTER COLUMN`. Idempotent: skips when the column is already `DATETIME2`
- `StartDate` deliberately stays `DATE` — the only producer is the Gantt drag-to-set-dates flow on the roadmap, which is a day-granular planning view
- `usp_Task_Create`, `usp_Task_Update`, and `usp_Task_UpdateDates` updated to bind `DueDate` as `sql.DateTime2` instead of `sql.Date`
- `TaskDrawer` "Deadline" field becomes `<input type="datetime-local">` so users can express "due by 17:00" rather than just a calendar day

### Fixed

- `DELETE /api/v1/workspaces/:id` previously returned 500 in v1.0.0: the SP attempted a physical delete but `Projects`, `Sprints`, `Tasks`, `WorkflowDefinitions`, and `UserRoles` all hold `REFERENCES Workspaces(Id)` without `ON DELETE CASCADE`, so every call hit a foreign-key violation. Migration 0023 + the rewritten `usp_Workspace_Delete` resolve the failure mode by switching to soft delete
- Newly-created tasks (most visibly EPICs) did not appear on the Epics page, Roadmap, or sprint summaries for up to 5 minutes after creation. `GET /epics/*`, `/roadmap/*`, and `/sprints/*` are server-cached in Redis (TTL 5 / 2 / 2 min), but `task.routes.ts` never busted those entries on write — so `POST /tasks` (and PATCH / DELETE / position / assignees / transition) left stale data behind. The Board appeared fresh because `/tasks` itself is not server-cached. Added `invalidateTaskCaches(projectId?)` and call it after every task mutation, mirroring the pattern components / labels / versions already use

### Added

#### Phase 6 — Post-launch (Week 32 — Admin user management)
- **Migration `0022_admin_user_perms.sql`** — adds five admin user-management permission slugs (`admin.users.{create,update,delete,reset_password,reset_mfa}`) and grants the full set to both `super-admin` and `user-admin`. Splitting recovery actions (reset password, reset MFA + lockout) from `delete` lets an org grant help-desk staff the recovery slugs without granting the destructive one. Idempotent
- 6 new admin-only stored procedures: `usp_Admin_User_Create` (skips the self-registration flow — admin sets a temporary password directly), `usp_Admin_User_Update` (name/email), `usp_Admin_User_HardDelete` (refuses if any FK reference remains; returns the blocking count so the API can surface a useful error), `usp_Admin_User_SetPassword` (force-reset to a temporary value), `usp_Admin_User_DisableMfa` (clears `MfaSecret` and every `MfaRecoveryCodes` row in one transaction), `usp_Admin_User_Unlock` (clears `LockedUntil` and the failed-login counter from migration 0017)
- Matching REST endpoints under `/api/v1/admin/users`, each gated on the corresponding slug from 0022

#### Phase 6 — Post-launch (Week 32 — TOTP MFA)
- **Migration `0021_mfa_recovery_codes.sql`** — adds `Users.MfaEnabledAt` audit timestamp + `dbo.MfaRecoveryCodes` (UserId, CodeHash, CreatedAt, indexed on UserId). The `MfaEnabled` and `MfaSecret` columns from `0001_init.sql` are reused
- 7 new stored procedures: `usp_User_GetMfaState`, `usp_User_SetMfaPending` (refuses if MFA already enabled — error 51020), `usp_User_EnableMfa`, `usp_User_DisableMfa` (transactionally clears secret + every recovery code), `usp_MfaRecovery_CreateBatch` (parses newline-separated bcrypt hashes via `STRING_SPLIT` and replaces the user's batch atomically), `usp_MfaRecovery_ListHashes`, `usp_MfaRecovery_Consume` (returns `@@ROWCOUNT` so the caller can distinguish "consumed" from "already used")
- New `apps/api/src/modules/auth/mfa.service.ts` wrapping `otplib` v13 (functional API: `generateSecret`/`generateURI`/`verifySync`). `verifyTotp` uses `epochTolerance: 1` to forgive ±30s of clock drift. Recovery codes are 10 codes per enrolment in `XXXX-XXXX-XX` format using a 31-char alphabet that omits ambiguous `0/O/1/I/l`, bcrypt-hashed at cost 12
- Login flow now MFA-aware: `POST /api/v1/auth/login` returns `{ mfaRequired: true, mfaToken }` (a 5-minute purpose-scoped JWT) instead of access/refresh tokens when the user has TOTP enabled. Failed-login counters are NOT cleared at this stage — only the second-factor success clears them
- New endpoints (all on `/api/v1/auth`):
  - `POST /mfa/setup` (auth required) → `{ secret, otpauthUri }`. Stores the secret as pending; the URI feeds straight into a QR renderer
  - `POST /mfa/verify-setup` (auth required, body `{ code }`) → enables MFA on first valid TOTP, returns 10 plaintext recovery codes (one-time view)
  - `POST /mfa/disable` (auth required, body `{ password, code }`) → requires both factors so a stolen access token alone can't strip MFA. Recovery codes accepted in lieu of TOTP
  - `POST /mfa/challenge` (body `{ mfaToken, code? | recoveryCode? }`) → completes the second step, issues real session tokens, sets the refresh-token cookie
- Defense in depth: TOTP and recovery code paths use the same code path for token issuance (`AuthService.issueSessionTokens`), so `clearLoginAttempts` and `createRefreshToken` are guaranteed to fire identically regardless of the second-factor branch

## [Unreleased] — Phase 5

### Added

#### Phase 5 — Post-launch (Week 27 — RBAC)
- **Migration `0018_rbac.sql`** — four new tables (`Permissions`, `Roles`, `RolePermissions`, `UserRoles`), ~50 seeded permission slugs across SYSTEM and WORKSPACE scopes, 7 built-in roles (`super-admin`, `user-admin`, `auditor`, `workspace-owner`, `workspace-admin`, `workspace-member`, `workspace-viewer`), and a one-off backfill from `WorkspaceMembers.Role` into `UserRoles`
- **Phase 4 a11y polish** — closed gaps surfaced during the post-launch audit: skip-to-main-content link, `aria-current="page"` on the active sidebar item, `prefers-reduced-motion` and `pointer: coarse` (44 px touch-target floor) media queries, `apps/next-web/.env.example`, removed bogus `role="content"` on `<main>` and the obsolete `scripts/deploy-sps.bat`
- 14 stored procedures: `usp_Permission_List`, `usp_Role_{Create,Update,Delete,GetById,GetBySlug,List,ListMembers,SetPermissions}`, `usp_UserPermissions_Get`, `usp_UserRole_{Assign,AssignBySlug,List,Revoke}`
- `requirePermission(slug | slug[])` Hono middleware in `apps/api/src/shared/middleware/permissions.middleware.ts` with per-request context cache, workspace-param resolution, and any-of slug evaluation so a system-scoped admin permission can satisfy a workspace-scoped check (e.g. super-admin bypassing `workspace.delete`)
- `apps/api/src/shared/lib/envAdminBootstrap.ts` — startup hook that idempotently promotes every user listed in `ADMIN_USER_IDS` to the `super-admin` system role, with a warning-logged legacy fallback in the middleware until the env var is removed
- `/api/v1/admin/roles` and `/api/v1/admin/user-roles` REST endpoints (list/get/create/update/delete roles, replace permission set, list members, assign/revoke user roles), all gated by `admin.roles.manage`
- Admin endpoints (`/admin/stats`, `/admin/users[/:id/{suspend,restore}]`, `/admin/workspaces`, `/admin/audit-log`) now permission-gated rather than env-var-gated
- Workspace mutation routes now permission-gated: `PATCH /workspaces/:id` (`workspace.update`), `DELETE /workspaces/:id` (`workspace.delete` OR `admin.workspaces.delete`), `POST /workspaces/:id/members` (`workspace.members.invite`)
- `usp_Workspace_Create` and `usp_WorkspaceMember_Add` now bridge legacy `WorkspaceMembers` writes into `UserRoles` so the new gates work for workspaces and members created after migration 0018
- Admin UI: `RolesTab`, `RoleEditorDialog`, and `PermissionPicker` components in `apps/next-web/src/components/admin/` plus a "Roles & Permissions" tab on the admin page

#### Phase 5 — Post-launch (Week 28 — RBAC expansion to project/sprint/task)
- **Migration `0019_rbac_perms_extension.sql`** — adds the `project.{create,update,delete}` and `sprint.{create,start,complete,delete}` permission slugs that 0018 missed; grants them to `workspace-owner` (all), `workspace-admin` (all except `project.delete`), and `workspace-member` (creates + sprint ceremonies). Idempotent
- 3 new lookup stored procedures used by the middleware to derive a workspace from a resource id: `usp_Task_GetWorkspaceId`, `usp_Project_GetWorkspaceId`, `usp_Sprint_GetWorkspaceId` (sprint variant joins through `Projects`)
- `requirePermission` now accepts `resolveWorkspace?: (c) => Promise<string | null>` so resource-keyed routes (`/tasks/:id`, `/projects/:id`, `/sprints/:id/{start,complete}`) can be gated. The resolved id is cached on the Hono context so multi-gate requests don't re-query, and a `null` return now surfaces as a 404 rather than 403 (resource missing, not permission missing)
- `TaskRepository`, `ProjectRepository`, `SprintRepository` each gained a `getWorkspaceId(id)` helper that wraps the new SP
- Tasks routes gated: `POST /tasks` (`task.create`), `PATCH /tasks/:id` (`task.update`), `PATCH /tasks/:id/transition` (`task.transition`), `DELETE /tasks/:id` (`task.delete`)
- Projects routes gated: `POST /projects` (`project.create`), `PATCH /projects/:id` and `POST /projects/:id/archive` (`project.update`), `DELETE /projects/:id` (`project.delete`)
- Sprints routes gated: `POST /sprints` (`sprint.create`), `POST /sprints/:id/start` (`sprint.start`), `POST /sprints/:id/complete` (`sprint.complete`)

#### Phase 5 — Post-launch (Week 29 — ownership-aware RBAC for comments/attachments/worklogs)
- **Middleware extension** in `apps/api/src/shared/middleware/permissions.middleware.ts`:
  - `ownerOnly: (c) => Promise<userId | null>` — *tightens* the primary check; the user must hold the slug AND be the resource owner. A `null` return surfaces as 404 (resource missing, not 403). Used for `*.own`-only perms like `comment.update.own`
  - `ownerFallback: { slug, resolveOwner }` — *widens* the primary check; if the user lacks the primary slug, they still pass when they hold the fallback slug AND are the owner. Encodes "DELETE my own comment" alongside "DELETE any comment"
- 3 new lookup SPs returning `{ WorkspaceId, OwnerId }` in one round-trip: `usp_Comment_GetContext`, `usp_Attachment_GetContext`, `usp_WorkLog_GetContext` (all join through `Tasks`)
- Each repository gained a `getContext(id)` helper. The route caches the result on the Hono context so PATCH/DELETE pay one SP call even when both `resolveWorkspace` and the owner check fire
- Comments routes gated: `POST` (`comment.create` via task→workspace), `PATCH /:id` (`comment.update.own` ownerOnly — admins cannot edit others' comments), `DELETE /:id` (`comment.delete.any` with `comment.delete.own` ownerFallback), `POST /:id/reactions` (`comment.create`)
- Attachments routes gated: `POST` (`attachment.create`; multipart body parsed once and cached on context to avoid double-stream-read), `DELETE /:id` (`attachment.delete.any` with `attachment.delete.own` ownerFallback)
- Worklogs routes gated: `POST` (`worklog.create`), `PATCH /:id` (`worklog.update.own` ownerOnly), `DELETE /:id` (`worklog.delete.any` with `worklog.delete.own` ownerFallback)
- Defense in depth: existing service/SP-level owner checks are preserved; the new middleware adds an explicit permission gate in front of them

#### Phase 5 — Post-launch (Week 30 — RBAC wiring across remaining workspace-scoped modules)
- 8 new lookup SPs (all `Get…WorkspaceId`): `usp_Version_…`, `usp_Label_…`, `usp_Component_…`, `usp_Workflow_…`, `usp_WorkflowStatus_…` (joins through Workflows), `usp_Automation_…`, `usp_Webhook_…` (direct `WorkspaceId` column), `usp_GitConnection_…` (direct column)
- Each affected repository gained a `getWorkspaceId(id)` helper. Workflow's repo also gained `getWorkspaceIdByStatus(statusId)` for the `/workflows/statuses/:statusId` routes
- Versions routes gated: `POST` (`version.create` via project lookup), `PATCH` + `POST /:id/release` + `POST /:id/archive` (`version.update`), `DELETE` (`version.delete`)
- Labels routes gated: `POST` / `PATCH` / `DELETE` all on `label.manage` (single permission per Phase 5 design)
- Components routes gated: `POST` / `PATCH` / `DELETE` all on `component.manage`
- Workflows routes gated: `POST` (`workflow.update` via project lookup), `POST /:wfId/statuses` and `POST /:wfId/transitions` and `DELETE /:wfId/transitions` via workflow lookup, `PATCH` and `DELETE /statuses/:statusId` via the new status→workflow→workspace lookup
- Automation routes gated: `POST` (`automation.create`), `PATCH` and `POST /:id/toggle` (`automation.update`), `DELETE` (`automation.delete`)
- Outgoing webhooks routes gated: `POST` (`webhook.manage` via body), `DELETE /:id` and `POST /:id/ping` (`webhook.manage` via webhook lookup)
- Git integration routes gated: `POST /git/connections` (`git.integration.manage` via body), `DELETE /git/connections/:id` via connection lookup
- Roadmap routes gated: `PATCH /roadmap/tasks/:id/dates`, `POST /roadmap/dependencies`, `DELETE /roadmap/dependencies/:taskId/:dependsOn` — all `task.update` since they mutate Tasks rows; workspace derived from the relevant task

### Security

- Closes a v1.0.0 vulnerability: prior to this release any authenticated user could `DELETE /api/v1/workspaces/:id` (no permission check beyond `authMiddleware`). Now requires `workspace.delete` (workspace-scoped) or `admin.workspaces.delete` (system-scoped)
- Same vulnerability class on `DELETE /api/v1/tasks/:id`, `DELETE /api/v1/projects/:id`, `POST /api/v1/sprints/:id/{start,complete}`, and the create/update mutations on those resources is closed by Week 28's gating
- Week 29 closes the same class on comments/attachments/worklogs and additionally enforces author-only edits on `PATCH /comments/:id` and `PATCH /worklogs/:id` (admins with `*.update.own` perms still cannot edit other users' content)
- Week 30 closes the remaining ungated mutation surface: any authenticated workspace member could previously delete a project, edit a workflow, create/delete an automation rule, modify a webhook configuration, or attach/detach a git connection without an explicit permission check

#### Phase 5 — Post-launch (Week 31 — legacy cleanup)
- **Migration `0020_drop_workspacemembers_role.sql`** — drops the free-text `WorkspaceMembers.Role` column. The Week 27 audit confirmed zero readers remain (no SP queries it for business logic; no API/frontend code consumes it). Idempotent: detects and drops any default constraint bound to the column before the `ALTER TABLE … DROP COLUMN`
- `usp_Workspace_Create` no longer writes to the dropped column. The `dbo.UserRoles` insert (added Week 27) is now the sole record of role membership at workspace creation
- `usp_WorkspaceMember_Add` no longer writes to the dropped column. The `@Role` parameter remains in the API contract — it now drives only the role-slug → `dbo.UserRoles` insert. The result set replaces `SELECT *` with an explicit column list (`Id, WorkspaceId, UserId, JoinedAt, RoleSlug`) so callers still receive the effective role string in one round-trip
- `permissions.middleware.ts` — removed the `LEGACY_ADMIN_IDS` env-var fallback and its warning log. `envAdminBootstrap.ts` (run on every server start) is the canonical promotion path; the safety net is no longer needed and would mask drift between the env var and the DB if it stayed
- `ADMIN_USER_IDS` env var still works for first-time bootstrap of a fresh deploy — the startup hook reads it and assigns `super-admin` once. After that, role membership is managed entirely through `/api/v1/admin/user-roles`

### Known follow-ups

- Notifications, integrations, search, reports — most are read-only or per-user (notifications) and don't need workspace-scoped gates; remaining triage is mostly hardening rather than new gates
- Epic routes (`epicRoutes`) currently expose only `GET /epics?projectId=`; if write endpoints are added, gate with the existing `epic.{create,update,delete}` perms (already in seed 0018)
- All Phase 5 RBAC follow-ups closed

---

## [1.0.0] — 2026-05-08

### Added

#### Phase 1 — Foundation (Weeks 1–6)
- Turborepo monorepo with `apps/api` (Hono.js) and `apps/next-web` (Next.js 14)
- Docker Compose stack: MS SQL Server 2022, Redis 7, MinIO
- GitHub Actions CI pipeline (lint, build, test)
- Numbered SQL migration runner (`scripts/db-migrate.ts`)
- Idempotent stored-procedure deployer (`scripts/db-deploy-sps.ts`)
- Authentication: register, login, JWT (15 min access / 7 day refresh), OAuth skeleton
- Stored procedures: `usp_User_*`, `usp_RefreshToken_*`, `usp_PasswordReset_*`
- Workspace & Project CRUD + member management (`usp_Workspace_*`, `usp_Project_*`, `usp_WorkspaceMember_Add`)
- Task / Issue CRUD with custom workflow statuses (`usp_Task_*`, `usp_Task_Transition`)
- Kanban Board UI — static columns, drag-and-drop via @dnd-kit
- Backlog view + Sprint creation (`usp_Sprint_Create`, `usp_Sprint_Start`)

#### Phase 2 — Core Features (Weeks 7–14)
- Sprint start/complete with burndown chart (`usp_Sprint_Complete`, `usp_Report_Burndown`)
- Comments: TipTap rich text, @mentions, emoji reactions (`usp_Comment_*`)
- File attachments via MinIO / Azure Blob with signed URLs (`usp_Attachment_*`)
- In-app WebSocket notifications + email delivery via BullMQ (`usp_Notification_*`)
- Advanced search: PQL (ProjectFlow Query Language) parser + `usp_Task_Search_PQL`
- Roadmap / Timeline Gantt view (`usp_Roadmap_GetItems`)
- Custom workflow editor with transition validation SPs (`usp_Workflow_*`)
- Dashboards: velocity, workload, created-vs-resolved, sprint summary reports (`usp_Report_*`)

#### Phase 3 — Advanced Features (Weeks 15–22)
- Automation engine: trigger → condition → action processor via BullMQ (`usp_AutomationRule_*`)
- Time tracking: work logs with per-sprint roll-ups (`usp_WorkLog_*`)
- Versions, Epics, Components, Labels with full SP coverage
- GitHub / GitLab integration: webhooks, PR + commit linking (`usp_GitPR_*`, `usp_GitCommit_*`)
- Slack + Microsoft Teams integration for channel notifications
- Outgoing webhooks with delivery queue, retry logic, HMAC-SHA256 signatures
- GraphQL API via Pothos schema builder and graphql-yoga (`/api/v1/graphql`)
- Admin panel: user management, workspace stats, full audit log viewer (`usp_Admin_*`, `usp_AuditLog_*`)

#### Phase 4 — Polish & Launch (Weeks 23–26)
- **Week 23** — Mobile responsive layout + WCAG 2.1 AA accessibility
  - Skip links, `aria-current`, `aria-expanded`, `role="tabpanel"` pattern throughout
  - Off-canvas hamburger sidebar for ≤768 px viewports
  - `prefers-reduced-motion` and `pointer: coarse` (44 px touch targets) media queries
  - Board and Column components annotated with ARIA list roles and labels
- **Week 24** — Performance: Redis cache expansion + SP execution plan tuning
  - `cache.ts`: ioredis singleton with `withCache`, `TTL`, `CacheKey` helpers; graceful fallback when Redis is unreachable
  - `responseCache` middleware: caches 2xx GET responses with `X-Cache: HIT/MISS` headers
  - Response cache applied to labels (15 min), components (15 min), versions/epics (5 min), sprints/roadmap (2 min), workspaces/projects (30 s), admin stats (5 s)
  - Rate-limiter upgraded from in-memory Map to Redis INCR + EXPIRE with in-memory fallback
  - DB connection pool tuned: `max` 20→50, `min` 2→5, `acquireTimeoutMillis`, `connectionTimeout`
  - `trackQueryTime()` logs slow SPs (>500 ms) to stderr
  - Migration 0016: 11 covering non-clustered indexes on Tasks, Comments, Notifications, WorkspaceMember, Project, Sprint, WorkLog, RoadmapItem + `UPDATE STATISTICS … WITH FULLSCAN`
- **Week 25** — Security audit + fix cycle (OWASP Top 10)
  - `securityHeaders` middleware: CSP, HSTS (production), X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, COEP, CORP
  - `X-Powered-By` and `Server` headers removed to prevent fingerprinting
  - CORS upgraded to whitelist-array origin validation with `exposeHeaders`
  - Body-size guard: 413 for payloads >4 MB
  - bcrypt cost factor raised from 10 → **12**
  - `JWT_SECRET` validated at startup — throws in production if missing or using default value
  - Account lockout: 5 consecutive failed logins → 15-minute lock (migration 0017, `usp_User_RecordFailedLogin`, `usp_User_ClearLoginAttempts`)
  - Refresh token cookie hardened: `SameSite=Strict`
- **Week 26** — Docs site, public launch, v1.0.0
  - Root `README.md` rewritten for public launch
  - `.env.example` files for API and Next.js app
  - TypeScript migration runner (`scripts/db-migrate.ts`)
  - TypeScript SP deployer (`scripts/db-deploy-sps.ts`) replacing the `.bat` script
  - GitHub Actions CI (`ci.yml`) and production deploy (`deploy-prod.yml`) workflows
  - This CHANGELOG

### Security

- All database access via parameterised Stored Procedures — SQL injection architecturally prevented
- JWT access tokens (15 min) + httpOnly/Secure/SameSite=Strict refresh cookies (7 days, rotated on use)
- Password reset tokens: SHA-256 hashed, 1-hour expiry, single-use
- Account lockout after 5 failed logins (15-minute lockout)
- TLS 1.3 enforced; SQL Server `encrypt=true`
- Signed MinIO URLs with 15-minute expiry
- Sensitive fields (`PasswordHash`, `MfaSecret`) never returned in API responses
- Full audit log for all write operations
- HMAC-SHA256 signatures on all outgoing webhooks

[1.0.0]: https://github.com/your-org/projectflow/releases/tag/v1.0.0
