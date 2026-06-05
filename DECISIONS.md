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

## 2026-06-06 — Phase 3.5a Notification Depth

Mentions (→ notification + auto-watch), auto-watch on commenting/assignment, watchers in the fan-out,
and comment assign/resolve. Backend-first with minimal (non-realtime) UI.

### Decisions

- **SP-per-op:** `usp_CommentMention_Add` (membership-validated, idempotent, returns `WasInserted`),
  `usp_Comment_Assign`, `usp_Comment_Resolve`. The four existing comment SPs now also SELECT
  `AssignedToId`/`ResolvedAt`/`ResolvedById`.
- **Mention encoding:** structured token `@[Display Name](userId GUID)` embedded in the comment body.
  The backend extracts userIds, validates each is a member of the comment's workspace, and silently
  skips non-members (no notification).
- **Mention dedup via `CommentMentions` PK** `(CommentId, MentionedUserId)`: edits don't re-notify
  already-mentioned users (`WasInserted = 0`) — no diffing.
- **Auto-watch (ClickUp-style):** comment author, mentioned users, comment-assignee, and new
  task-assignees all auto-watch the task.
- **`fanOutTaskEvent`** = union(reporter, assignees, watchers) − actor − extraExclude. `COMMENT_ADDED`
  (excludes just-mentioned users to avoid double-notifying) and `TASK_UPDATED`. `TASK_ASSIGNED` stays
  targeted (unchanged).
- **Dual-path assign/resolve:** GraphQL mutations (`assignComment`/`resolveComment`) for the spec, plus
  REST endpoints for the SSR frontend — mirrors the watchers dual-path.
- **`TASK_UPDATED` debounce** via Redis `SET NX EX` (60s/task), fail-open. Due-date trigger deferred
  (`updateTask` has no before/after diff).

### Execution-time deviations (logged during two-stage review)

- **Fan-out reads PascalCase `ReporterId`.** `usp_Task_GetById` is `SELECT *` (raw PascalCase, carries no
  assignees), so the plan's camelCase `task.reporterId`/`.assigneeIds` were `undefined` — reporter
  notifications were a silent no-op (this was also a pre-existing bug in `comment.service`). `fanout.ts`
  now reads `(task).reporterId ?? (task).ReporterId`; assignees are covered via the watcher path
  (assignment auto-watches), so fan-out's `assigneeIds` is best-effort and normally empty. Verified by an
  integration test (reporter — non-actor, non-watcher — receives `COMMENT_ADDED`). Payloads are built
  from the known `taskId` + a casing-tolerant title read, never `task.id`/`task.title`.
- **`actorId` normalized for `notify`.** `computeRecipients` uppercases recipient ids, so fan-out passes
  `norm(actorId)` to `notificationService.notify` to keep its own self-exclusion guard effective.
- **SP hardening.** `usp_Comment_Assign`/`_Resolve` UPDATEs filter `DeletedAt IS NULL` (close the
  guard→write race; matches `usp_Comment_Update`) and wrap the body in `BEGIN TRY/BEGIN CATCH THROW`
  (matches `usp_TaskWatcher_Add`).
- **REST assign/resolve authz** corrected to `requirePermission('task.update', { ownerFallback: { slug:
  'comment.update.own', resolveOwner } })` = "task-editor OR comment author", mirroring the DELETE route
  and the GraphQL author-or-EDIT intent. (The plan's literal snippet used `comment.update.own` as the
  primary slug, which would have let any member holding it act on any comment.)
- **REST input/error hardening.** `/assign` returns 400 when `assigneeId` is missing/non-string; `/resolve`
  mirrors `/assign`'s try/catch, mapping SP THROW `51402` → 404 (was an uncaught 500). `/assign` maps
  `51401` → 422 `ASSIGNEE_NOT_MEMBER`.

### Known limitations / follow-ups (not blockers)

- **Debounce coalescing:** `transitionTask` and `setAssignees` share the key
  `notif:debounce:TASK_UPDATED:${taskId}` (60s), so in a burst one change type (status vs assignees) can
  be coalesced away. Acceptable for noise reduction; include the change type in the key if per-change
  audit fan-out is ever required.
- **TOCTOU in GraphQL `assertCanEditComment`:** the comment→task→List lookup and the SP write are
  separate round-trips; a concurrent task move could shift the List between check and write (ms window,
  over-authorizes toward stricter; SP-tier workspace validation still applies). Follow-up: fold the List
  check into the SP.
- **Deprovisioned author:** a user removed from the workspace can still assign/resolve their OWN comments
  (author bypass on both paths); the assign SP still rejects a non-member assignee. Policy decision deferred.
- **Frontend:** `workspaceId` is `string | null` — when null, member loading is skipped, so the assign
  popover shows no members and an assigned comment displays "Assigned to {unknown}". Mention chips render
  via React text nodes (auto-escaped; no XSS). Minor follow-ups: stable segment keys (currently index),
  `role="option"` on suggestion items, an unassign affordance, the edit composer not yet using
  `MentionInput`, and the pre-existing hardcoded-English `relativeTime()`.
- **Saved-for-later notification columns** (`Notifications.SavedForLater`/`SavedAt`) + the `IX_Notif_UserSaved`
  index ship in migration 0033 but are unused this slice — they belong to the future 3.5c Inbox.

## 2026-06-06 — Phase 3.5b Realtime Client (Apollo + SSE)

### Decisions

- **Apollo is delta-only.** The SSR + server-action data path remains the single source of truth.
  A client-only `ApolloProvider` (`ApolloRealtimeProvider`, mounted inside `IntlProvider` in the root
  layout) is used *solely* for subscriptions. The client uses `fetchPolicy: 'no-cache'` for query +
  watchQuery so it never becomes a parallel cache/data layer. Live deltas mutate scoped local component
  state, never trigger a parallel full fetch.
- **Transport = `graphql-sse`** (Server-Sent Events) bridged into Apollo via a custom `SSELink`
  (`ApolloLink` wrapping `createClient` from graphql-sse). graphql-yoga's SSE endpoint already exists at
  `/api/v1/graphql`. CORS already allows the web origin with `Authorization` + credentials.
- **SSE auth:** the browser obtains the current access token (httpOnly `pf_at` cookie, unreadable by
  client JS) via a `getRealtimeToken` server action and sends it as a `Bearer` header. graphql-sse's
  `headers` option is an **async function invoked on each (re)connect**, so the 15-minute token is
  refreshed on reconnect and long-lived subscriptions survive rotation.
- **Per-user notification routing:** `createPubSub` topic-with-argument channel
  `'notification:added': [userId, { notification }]`. `notificationService.notify` publishes the parsed
  notification to each recipient's topic after a successful `repo.create` (best-effort try/catch; never
  breaks creation), preserving the existing dedup + actor-exclusion logic.
- **Security:** the `notificationAdded` subscription binds to the **authenticated** user's id from
  context (`ctx.user.userId`) and structurally ignores any client-supplied `userId` arg — a user can only
  ever receive their own notifications. Extracted as `notificationAddedSubscribe` for unit-testability;
  throws `UNAUTHENTICATED` when `ctx.user` is null.
- **`commentAdded`** broadcasts all `comment:created`; the client filters by `taskId` and de-dupes by
  `id` (the author's own comment also arrives via the existing `refetch()` — guarded). Live rows are
  lightweight (`mapLiveComment` defaults missing fields) and get replaced by enriched rows on the next
  SSR refetch.
- **Import direction:** `notification.service` → `graphql/pubsub` (which depends only on `shared/lib`) is
  acyclic and accepted. (Alternative — move pubsub to `shared/lib` — out of scope.)

### Apollo 4.x notes (the plan assumed 3.x)

- Installed `@apollo/client@4.2.2`. v4 restructured exports: core (`ApolloClient`, `InMemoryCache`,
  `ApolloLink`, `Observable`, `gql`) come from `@apollo/client`; React hooks/provider (`ApolloProvider`,
  `useSubscription`) come from **`@apollo/client/react`**. `ApolloClient` is **no longer generic**.
  `Observable` is now RxJS's. `ApolloLink.request` is typed `(op: ApolloLink.Operation) =>
  Observable<ApolloLink.Result>` (namespaced types).
- One localized, commented cast in `SSELink` at the graphql-sse `ExecutionResult` ↔ Apollo
  `FormattedExecutionResult` seam (differs only in the `errors` element type; the SSE wire payload is the
  formatted/serialized shape, so Apollo's typing is runtime-accurate). No `any`, no `@ts-ignore`.

### Deferred / known follow-ups (not blockers)

- **Board/list `taskUpdated` subscription deferred** (per spec §9) — only the notification bell + comment
  appends are wired live this slice.
- **Live e2e run deferred:** `e2e/realtime-notifications.spec.ts` is authored and Playwright-collectable
  (`--list`), but its live run is deferred to a coordinated run with explicit **local** DB env
  (`DB_SERVER=localhost … DB_NAME=ProjectFlow_Test`) — the default Playwright `webServer` boots the API
  against the prod-pointing `apps/api/.env`, so it must never run with that env. (A shell-exported env var
  overrides Node's `--env-file`, verified, so explicit local exports are the safe path.)
- **i18n straggler:** `NotificationBell`'s badge `aria-label` is hardcoded English; 3.5c localizes the
  notifications UI.
- **npm audit:** the `@apollo/client` install pulled in a transitive high-severity advisory (not fixed
  here — `audit fix` could churn unrelated bleeding-edge deps).
