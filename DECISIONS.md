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

## 2026-06-06 — Phase 3.5c Inbox + Presence

### Inbox

- **By-type filter** via `usp_Notification_List` `@Types` (CSV + `STRING_SPLIT` + `LTRIM/RTRIM`) + `@SavedOnly`;
  the six tabs (All/Unread/Assigned/Mentions/Comments/Saved) map to filter sets client-side (`INBOX_TABS`),
  applied SERVER-side via `getNotifications({ ...filter })` on a `?tab=` URL param. The unread-count second
  recordset stays unfiltered (the badge reflects ALL unread, not the filtered view).
- **Save-for-later** = `Notifications.SavedForLater`/`SavedAt` (migration 0033, 3.5a) + `usp_Notification_SetSaved`
  (ownership-guarded `WHERE Id=@Id AND UserId=@UserId`; zero-rows `RAISERROR`) + REST `PATCH /:id/saved`
  (mirrors `markRead`'s try/catch → 404) + GraphQL `setNotificationSaved`. The cross-user → 404 tenant guard
  is integration-tested.
- **Live prepend** on the Inbox page via the 3.5b `notificationAdded` subscription — SSR remains the base
  (items re-seeded from props via `useEffect([initialItems])`), the subscription only prepends a de-duped
  lightweight delta (`mapLiveNotification`), no parallel fetch.
- **Notifications UI i18n closed:** the previously-deferred notifications view + dropdown are now fully
  localized (`Inbox` + `Presence` namespaces, en/id parity enforced by `messages.unit`), using `t.rich` for
  the per-type summary sentences.
- **Dropdown mock removed:** the topbar `NotificationsSheet` now renders REAL recent notifications threaded
  from ONE SSR fetch (`getNotifications({ pageSize: 8 })` in `(app)/layout.tsx`) → `Layout1` → context →
  header → sheet (same path as the bell's `initialUnread`; no client-side Apollo query). The 16
  `topbar/notifications/item-*.tsx` mock components are deleted; shared type→icon/tone metadata extracted to
  `components/notifications/notification-meta.ts` (consumed by both the Inbox page and the dropdown).
- `usp_User_GetDisplay` (Id/Name/AvatarUrl) intentionally does NOT filter `DeletedAt IS NULL` — display
  continuity for since-deleted commenters in presence/inbox surfaces.

### Presence (no table — ephemeral Redis)

- **No DB table.** Per-task Redis hash `presence:task:{taskId}` (field=userId → JSON `{name, avatarUrl,
  typing, lastSeen}`). `PRESENCE_TTL_MS`=30s is the activity window (`computeActiveViewers`, pure + unit-
  tested); `KEY_TTL_SEC`=60s is a whole-key expiry so abandoned tasks self-clean. Stale fields are evicted
  opportunistically on read. User display (name/avatar) cached 5 min (`withCache`/`TTL.LONG`) to avoid a DB
  read per heartbeat.
- **GraphQL:** `presenceHeartbeat`/`presenceLeave` mutations (publish the snapshot on `presence:updated`,
  keyed per-task) + `presenceUpdated` subscription. Registered via `builder.subscriptionFields` (extends the
  Subscription root defined in schema.ts; registration runs after it). **All three are VIEW-gated**
  (`requireObjectLevel(ctx, 'LIST', taskListId, 'VIEW')`) — stronger than the older `requireAuth`-only,
  un-keyed `taskUpdated`/`commentAdded` subs. Identity is server-side (`ctx.user.userId`); the only client
  arg is `taskId` (authz-checked).
- **Snapshot-on-subscribe** is delivered via the frontend mount-heartbeat (the hook beats on mount), so no
  custom initial-value wrapper is needed server-side.
- **Frontend:** `usePresence(taskId)` heartbeats on mount + every 20s (< 30s TTL, safe margin), re-beats on
  typing change, and LEAVES on tab-hidden + unmount (cleanup clears interval + listener + leave — no leaks).
  `PresenceBar` shows ≤5 initials avatars + ICU-pluralized "viewing"/"typing", filtering out the current
  user. Typing is wired only on the NEW-comment composer.
- **Multi-instance** presence relies on the existing Redis-backed pubsub (3.5b). Verified by the presence
  integration test (heartbeat → snapshot → stale-drop after TTL); the VIEW-authz path is covered by the
  (deferred) two-context e2e.

### Testing / verification

- API: 238 unit + 141 integration (the 141 includes 5 new: 3 inbox-filter/save/cross-user-404 + 2
  presence-redis) — **run ONLY against local Docker `ProjectFlow_Test` via explicit local DB env**, never
  the prod-pointing npm scripts. C1 SPs were deployed to local via explicit env (`241 deployed, 0 failed`).
- Web: 87 unit + `messages.unit` en/id parity; `npm run build` green.
- e2e `presence.spec.ts` authored + Playwright-collectable (`--list`); live run DEFERRED to a coordinated
  local-DB run alongside `realtime-notifications.spec.ts` (default webServer boots the API against prod
  `.env`). The presence e2e's drawer-open (board card click) + composer selectors are marked
  `TODO(live-run)`.

### Known follow-ups (not blockers)

- **Per-keystroke heartbeat:** `setTyping` (= `sendBeat`) fires a `presenceHeartbeat` on each composer
  change; backend `hset` is cheap/idempotent, but an edge-guard/debounce (beat only on typing-state
  transition) would cut mutation volume. Within the spec's "setTyping re-beats" intent.
- **Empty-taskId heartbeat:** `usePresence` is called unconditionally (rules of hooks) so a null-task drawer
  would beat with `taskId:''` (swallowed by `.catch`; backend authz rejects). A `skip: !taskId` guard would
  avoid the no-op round-trip.
- **`userDisplay` resilience:** the cache-read path isn't Redis-degrade-wrapped, but `cacheGet` already
  swallows Redis errors internally (returns null → falls through to DB), so heartbeat only fails on a DB
  outage — acceptable.
- **`taskListId` per-heartbeat DB read:** the presence resolvers call `taskRepo.getById` per heartbeat
  (high-frequency); a list-id-by-task cache could optimize. Out of scope.
- **`computeActiveViewers` test:** add an explicit `lastSeen` missing/0 → stale assertion (currently covered
  via the TTL-window + malformed cases).

## 2026-06-06 — Phase 3.5 follow-ups (polish + board/list taskUpdated)

Cleared the deferred follow-ups from 3.5b/3.5c on `feat/phase3.5-followups`.

### Polish (resolves the 3.5b/3.5c "known follow-ups" above)

- **Presence typing edge-guard:** `usePresence` now returns a `setTyping` that only beats on the
  false→true / true→false transition (the composer fires per-keystroke); the 20s keepalive + mount
  snapshot still beat unconditionally. Cuts heartbeat volume to ~2 per typing burst.
- **Empty-taskId guard:** `usePresence` skips the subscription (`skip: !taskId`) and every mutation when
  `taskId` is falsy (rules-of-hooks unconditional call from null-task drawers) — no more no-op round-trips.
- **Bell aria-label i18n:** `NotificationBell` uses `useTranslations('Inbox')` → `Inbox.unreadAria` (ICU
  plural, en + id) instead of a hardcoded English string.
- **Tab-aware inbox live prepend:** `matchesInboxTab(tab, {type,isRead})` (in `inbox-tabs.ts`, unit-tested)
  mirrors the server `INBOX_TABS` filter so a `notificationAdded` delta only prepends into the active tab
  (Saved never matches a live delta — re-seeds from SSR). Previously every delta prepended regardless of tab.

### Board/list `taskUpdated` live subscription (spec §9 — was deferred in 3.5b)

- **Consumes the existing server subscription** `taskUpdated(projectId)` (no backend change). `TASK_UPDATED`
  selects the card-rendered camelCase fields; `taskService` returns camelCase, so the happy-path delta is
  well-shaped (verified via `task.service.ts` webhook dispatch using `task.id/title/status/projectId`).
- **`mergeTaskDelta(tasks, delta)`** (pure, unit-tested): UPDATE-ONLY by id, DEFENSIVE merge (only non-null
  delta fields overwrite, so the known partial publisher — the custom-field value-set path that emits
  `{ task: { id } }` — can't blank a title). `position` is never touched (GraphQL Task carries none; ordering
  stays local/optimistic). Returns the same array ref when nothing matched (skips re-render).
- **`useLiveTasks(projectId, base)`** feeds the board's `useOptimistic` layer (SSR base → live patch →
  optimistic drag). The hierarchy list-view gets an inline PascalCase-aware merge (title/issueKey) + a new
  `projectId` prop from its page.
- **Scoping by id-match, not projectId:** the server channel is global (`task:updated`); `taskUpdated`'s
  `projectId` arg is a server-ignored placeholder. Since the board only holds the active project's tasks,
  matching the delta id against visible tasks scopes correctly and drops cross-project chatter without
  relying on the (uncertainly-shaped) delta `projectId`.

#### Deferred (not blockers)

- **Live add/remove:** update-only. A task newly created/moved-in by another user appears on the next SSR
  re-seed (navigation/revalidation), not instantly. Add-on-unknown-id was rejected because the partial
  `{ task: { id } }` publisher would create ghost cards.
- **Views Engine surfaces:** `components/views/board-view-engine.tsx` + `components/views/list-view.tsx`
  (config-driven view rendering) are NOT wired — only the canonical `/board` and `/lists/[listId]` surfaces.
  They can adopt `useLiveTasks` when revisited.
- **Over-broadcast:** every authed SSE client receives all `task:updated` events; the client filter is the
  only scope. Per-project channel keying is a backend optimization out of scope here.
- **Live run:** unit + tsc + build green; an end-to-end live verification rides the same deferred coordinated
  local-DB stack run as the realtime/presence e2e.

### Live e2e run (realtime + presence) — EXECUTED + GREEN; 3 real bugs fixed

Ran `e2e/realtime-notifications.spec.ts` + `e2e/presence.spec.ts` live against local Docker `ProjectFlow_Test`
+ Redis (explicit local DB env per `e2e/README.md`). Both initially FAILED at the SSE-delivery assertion;
isolating server-vs-client with throwaway graphql-sse probes surfaced **three real (latent-since-3.5b) bugs**,
now fixed. Final: **2/2 e2e pass**, API survives both SSE teardowns, API 238 unit, web tsc+build green.

1. **GUID-case pubsub topic mismatch (notifications never delivered).** The pubsub topic key is a
   case-SENSITIVE string; the mention parser lowercases the recipient id (`a665…`) so `notify` published to
   `notification:added:a665…`, while the subscription keys off the JWT's DB-native UPPERCASE id
   (`A665…`) → topics never matched. (SQL `uniqueidentifier` compares case-insensitively, so the REST inbox
   still showed the row — masking it.) Fix: lowercase the topic key on BOTH sides
   (`notification.service.notify` publish + `notificationAdded` subscribe).
2. **`SSELink` leaked `operation.client` → Yoga 400 (every browser subscription).** `SSELink.request` sent
   `{ ...operation, query }`, spreading Apollo-Client-4-only fields (notably `operation.client`) into the
   graphql-sse request body; graphql-yoga strict param validation rejects unknown params
   (`Unexpected parameter "client"`) with 400 → the browser SSE retry-stormed and never connected. The node
   probe passed a clean `{query}` so it couldn't reproduce it. Fix: send only `{ operationName, query,
   variables, extensions }`.
3. **SSE disconnect crashed the whole API.** graphql-yoga's SSE response `ReadableStream`, streamed via
   `@hono/node-server`, double-closes on client abort → uncaught `ERR_INVALID_STATE: ReadableStream is
   already closed` in a microtask → process exit on every client disconnect. Fix: a TARGETED
   `uncaughtException`/`unhandledRejection` guard (server boot path) that swallows ONLY that benign teardown
   race and keeps fail-fast for everything else.

Test-side: relaxed the realtime badge locator to `/unread notification/i` (the localized aria-label is now
ICU-pluralized — `Inbox.unreadAria`), and fixed the presence `TODO(live-run)` composer selector to
`getByPlaceholder(/add a comment/i)` (the drawer has multiple textboxes). Presence delivery itself needed no
change once the API stopped crashing — taskId-keyed topics already agreed.

## 2026-06-06 — Phase 3.5 follow-ups (round 2): Views-Engine live wiring, i18n stragglers, Bug C proper fix, 3.5a correctness

Branch `feat/phase3.5-followups-2` off `ca9ad51`. Four follow-ups carried over from the prior round's
deferrals/notes. Lean flow: parallel implementers on disjoint packages, reviewed diffs, per-task commits.

### 1. Views Engine surfaces now wired to live taskUpdated (closes the prior "NOT wired" note above)
board/list/table/calendar `components/views/*` extracted `taskPage.tasks` directly and never received live
deltas. Spliced `useLiveTasks()` onto the SSR set in all four — reusing the existing hook + `mergeTaskDelta`
UNCHANGED (same normalized `Task` shape). The `projectId` subscription arg is a required TRUTHY PLACEHOLDER
only (`task:updated` is a global channel; scoping is client-side via mergeTaskDelta id-match): board uses
`scopeId`; list/table/calendar use `activeView.id` (already in their props — no prop-contract widening; Apollo
dedupes the shared key). A live `dueDate` change re-buckets the calendar chip. `assigneesByTaskId` keeps
reading the base set (merge is update-only → id set unchanged).

### 2. Bug C — PROPER fix: surgical idempotent SSE stream at the bridge (replaces reliance on the global guard)
Root cause: on SSE client disconnect both `@hono/node-server` and Yoga tear down the SAME web `ReadableStream`;
the second close throws `ERR_INVALID_STATE: ReadableStream is already closed` from a floating microtask. The
prior round swallowed it with a global `uncaughtException`/`unhandledRejection` guard. PROPER FIX: interpose
`guardedEventStream` (`apps/api/src/graphql/sse-stream.ts`) at the `/graphql` bridge — for `text/event-stream`
responses only, Yoga's body is re-wrapped in a single-shot, pull-based, try/catch-guarded passthrough so the
stream `@hono/node-server` actually touches can never double-close. The race is removed AT THE BOUNDARY, not
swallowed after the fact. Decided AGAINST bumping `@hono/node-server` to 2.x (large regression surface) in
favor of this contained fix. The global guard is RETAINED as a documented defense-in-depth backstop
(fail-fast for every non-benign error). 7 unit tests. **Live-verified:** ran the realtime SSE spec against
Docker `ProjectFlow_Test` + Redis and grepped the full API log — the backstop NEVER fired and no
`ERR_INVALID_STATE`/uncaught was logged: the double-close no longer happens at all.

### 3. 3.5a correctness follow-ups
- **TASK_UPDATED debounce key was too coarse.** `notif:debounce:TASK_UPDATED:${taskId}` keyed by taskId only,
  so within the 60s window a status change and an assignee change on the same task collapsed and the second
  distinct change was silently dropped. Fix: centralized `taskUpdatedDebounceKey(taskId, change)` keyed by
  taskId AND change type — different change types each get their own gate; bursts of the SAME change type
  still coalesce (intended). +3 unit tests.
- **assertCanEditComment TOCTOU — investigated; accepted residual (no code change).** `requireObjectLevel`
  fail-closes on a null listId (`authz.ts`: `if (!id) notFound()`), so there's no null-scope bypass. The gate
  is the statement immediately preceding the SP write on every mutating comment path (GraphQL assign/resolve
  + REST `/comments/:id/assign|resolve`, the latter gated by `requirePermission('task.update',
  ownerFallback: comment.update.own)`). `usp_Comment_Assign`/`_Resolve` enforce row liveness
  (`DeletedAt IS NULL`) so a concurrent delete can't be clobbered, and assign re-checks assignee workspace
  membership. The only residual is a sub-second permission-revocation race over the app-layer ACL; closing it
  atomically would mean duplicating the hierarchy ACL into SQL (or a cross-statement DB transaction over the
  ACL) — explicitly rejected as ACL-logic duplication/drift. Residual accepted: bounded exposure, SP
  guarantees existence + a valid assignee at write time.

### 4. i18n stragglers closed
Enum-derived priority labels (list/board/bulk now map to `Board.priority*` instead of raw enum), Views Engine
UI (view-surface, board/list/table/calendar, filter-builder, bulk-bar, view-tabs), and hierarchy (SidebarTree
+ nodes; `HIERARCHY_LABELS` moved to a `Hierarchy` catalog namespace, `window.prompt` label translated).
Calendar weekdays derive locale-correctly via native `Intl.DateTimeFormat` (no static array). New keys under
`Views`/`Views.filters`/`Views.bulk`/`Views.tabs`/`Hierarchy` in BOTH `en.json` + `id.json` (real Indonesian);
parity test green. INTENTIONALLY LEFT: free-text WorkflowStatus names (workspace-configured, not an enum) and
`table-view` boolean Yes/No. Follow-up noted: set a global next-intl `timeZone` default in the i18n request
config (pre-existing `ENVIRONMENT_FALLBACK` dev advisory surfaced in e2e logs).

**Verification:** API 248 unit, web 98 unit + i18n parity, tsc clean (both packages), web production build OK;
live e2e realtime+presence 2/2 (Bug C backstop never fired), views 6/6 + hierarchy 1/1. DB only local Docker
`ProjectFlow_Test`.

## 2026-06-06 — Phase 3.5 deferred-item cleanup

Closed the six documented Phase 3.5 deferrals on `feat/phase3.5-deferred-cleanup`, executed task-by-task via
subagent-driven-development (fresh implementer + two-stage spec/quality review per task).

### 1. Live add/remove (§1) + per-project/-workspace scoping (§2) — the big change
Replaced the single **global, unkeyed** `task:updated` pubsub channel (every client saw every project's task
chatter; payloads were update-only on the client) with a **keyed lifecycle topic** `task:event` carrying a
discriminated `{ kind: 'created'|'updated'|'deleted', projectId, task?, taskId? }`, published to BOTH a
`prj:{projectId}` key and a `ws:{workspaceId}` key (`apps/api/src/graphql/task-events.ts`:
`publishTaskEvent`/`publishTaskMove`; workspace id resolved via cached `ProjectRepository.getWorkspaceId`).
A new extracted, unit-tested `taskEventsSubscribe` (`apps/api/src/graphql/subscriptions/taskEvents.ts`)
replaces the `taskUpdated` subscription field and **authz-gates the scope**: project scope →
`requireObjectLevel(ctx,'SPACE',projectId,'VIEW')`; workspace scope (EVERYTHING) →
`requireWorkspacePermission(ctx,workspaceId,'workspace.read')`; neither → `BAD_REQUEST` (fails closed).
Topic keys are built in ONE place (`taskEventKey.project/.workspace`) imported by both publish and subscribe
sides, so they cannot drift. **Every** mutating task site now emits the matching event — GraphQL
create/update/transition/delete/move AND every REST route (create, update, transition, position, assignees,
type, custom-field, move, delete); cross-project move emits `deleted`(old)+`created`(new), same-project emits
one `updated`. Client: `applyTaskEvent` (created/updated/deleted with dedupe + an `accepts` filter) + a
reworked `useLiveTasks(base, scope, accepts)` (SSR stays source of truth; live events patch on top; a
`useRef` keeps a non-stable `accepts` predicate fresh without re-subscribing) wired into the project board,
the hierarchy list view, and all four Views-Engine surfaces.

- **Key correction vs the spec's hedge:** the feared "partial `{task:{id}}` publisher" does NOT exist — every
  legacy `task:updated` site published a full task, so live `created` events carry full payloads everywhere
  and no ghost-card mitigation was needed.
- **Two real PascalCase-casing bugs found + fixed (this class bit the SSE work twice before).** (a) Every
  publish site initially keyed by `task.projectId` (camelCase), which is `undefined` on the PascalCase SP rows
  → events keyed `prj:undefined` and reached no subscriber. Fixed by sourcing projectId casing-tolerantly at
  every site (`eventProjectId`/`taskProjectId` = `x.projectId ?? x.ProjectId`). (b) The live e2e then proved
  the SSE event arrived but with an **all-null payload**: `TaskType`'s scalar resolvers used camelCase-only
  `t.exposeString('id'|'title'|…)`, but the subscription publishes the raw PascalCase SP row (the query path
  maps to camelCase first; the subscription does not). Fixed by making the `TaskType` scalar resolvers
  casing-tolerant (mirrors the client `normalizeTask`). `createdAt`/`updatedAt` made nullable (safer than
  `new Date(undefined)`; no GraphQL codegen in next-web so non-breaking).
- **Owning-project resolution for node-scoped views (deviation from plan):** the plan assumed an existing
  client-reachable node→Space read for LIST/FOLDER; none exists. Resolved instead by reading the owning
  `projectId` off the first SSR task (a LIST/FOLDER belongs to exactly one Space, so all its tasks share one
  `projectId`; verified against the schema: `Lists.SpaceId`/`Folders.SpaceId`, `Tasks.ProjectId=List.SpaceId`).
  Required widening `VIEW_TASKS_QUERY`/`PREVIEW_VIEW_TASKS_QUERY` to select `projectId`+`listId`.
- **Documented v1 boundaries (accepted):** (a) FOLDER views `accepts=()=>false` — live update/delete of
  already-shown cards work, but a live *new* card arrives only on the next SSR re-seed (client can't cheaply
  verify nested-folder membership). (b) An empty LIST/FOLDER scope (0 SSR tasks → no owning projectId) skips
  the live subscription until SSR re-seed. (c) Live event payloads carry scalars only; `assignees`/
  `customFieldValues` resolve empty/null on live events (the SP row doesn't carry them) and reconcile on the
  next SSR — `mergeTaskDelta` treats null as "unchanged", so a partial payload never blanks existing data.
- **Live e2e** (`e2e/live-board.spec.ts`): two contexts, B creates→transitions→deletes over REST, A sees
  add→re-bucket→remove with no reload. A one-time ~1.5s settle gates B's first publish against the Redis
  SUBSCRIBE round-trip (Redis pub/sub has no replay); all event-arrival waits use auto-retrying `expect`.
  No `ERR_INVALID_STATE`/uncaught during SSE teardown (prior rounds' guarded stream + backstop held).

### 2. §3 EVERYTHING views — verified, no code change
Confirmed already-wired end-to-end: sidebar `everything-nav` → `/views/EVERYTHING/{workspaceId}`; the route
maps `EVERYTHING → {workspaceId, null node scope}`; reads thread `workspaceId`; the API
`requireEverythingWorkspace` → `requireWorkspacePermission(…,'workspace.read')` rejects non-members and a
missing/foreign workspaceId (fails closed). Existing `views.spec.ts` EVERYTHING test passes live. No change.

### 3. §4 i18n — table boolean Yes/No
`Views.table.yes/no` added to `en.json` (Yes/No) + `id.json` (Ya/Tidak); `table-view` boolean cell now uses
`t('table.yes'|'table.no')` (translator threaded into the module-scope `formatCellValue`). Parity test green.

### 4. §5 deprovisioned-author block on comment assign/resolve
There is no TS-layer workspace-membership gate — membership is enforced in SQL. Added an **actor**-membership
check (`THROW 51403`) to both `usp_Comment_Assign` and `usp_Comment_Resolve` (after the existence check,
before the UPDATE), mapped `51403 → FORBIDDEN/403` in the GraphQL resolvers AND both REST handlers. This is
the single enforcement point covering the GraphQL `assertCanEditComment` author-bypass path (ownership ≠
membership) where the deprovisioned author would otherwise slip through. Note: for the REST paths the
`requirePermission(task.update, ownerFallback: comment.update.own)` middleware ALREADY 403s a removed member
(no slugs) — so the SP gate is genuine defense-in-depth, proven by a direct service-layer test asserting the
SP throws 51403 (alongside the HTTP 403 test).

### 5. §6 dependency advisories
- **hono** 4.12.18 → 4.12.23 via in-range `npm audit fix` (patches JWT-scheme bypass + Set-Cookie injection +
  IP-restriction + mount-prefix advisories). `turbo` floated 2.9.9→2.9.16 alongside (pinned `latest`; benign
  in-range lockfile drift + its own security fix).
- **next** forced to 16.2.7 (`npm audit fix --force`) — patches the high-severity App Router middleware/proxy
  bypass GHSA-26hh-7cqf-hhc6. Scope confined to the `next` family + one nested `postcss` transitive; React et
  al. untouched. App already uses the v16 `proxy` convention; build green, proxy auth-gate intact. Residual
  moderate `postcss` chain left (its only fix is a catastrophic `next@9.3.3` downgrade — out of scope).

**Verification (all on the final tip):** API 256 unit / 143 integration / tsc-clean build; web 104 unit /
production build green; e2e `live-board` green (full suite 15 pass / 2 fail = `board-categories` legacy flake
+ `freeze-toast`, both proven pre-existing on next@16.2.5, not regressions). DB only local Docker
`ProjectFlow_Test` + local Redis. Final whole-implementation review: READY TO MERGE (no Critical/Important).

## 2026-06-06 — Phase 5a Dependencies

Spec `docs/superpowers/specs/2026-06-06-phase5-deps-relationships-recurring-templates-design.md` §3;
plan `docs/superpowers/plans/2026-06-06-phase5a-dependencies.md`. Built batch-by-batch via implementer
subagents + a consolidated review, verified on local Docker `ProjectFlow_Test` + Redis.

### Decisions
- **Canonical directed edge** `(TaskId waits_on DependsOn)` — `DependsOn` must finish first. Reused the
  legacy `TaskDependencies` table (migration `0007`). Migration `0034` adds `WorkspaceId` (denormalized),
  narrows the `Type` CHECK to `'waiting_on'`, and converts legacy rows: `BLOCKS` → swap direction,
  `IS_BLOCKED_BY` → keep, `RELATES_TO`/`DUPLICATES` → deleted (move to 5b relationships). `WorkspaceId`
  is backfilled AFTER the swap (review fix) so a swapped edge's tag reflects the new `TaskId`.
- **The two "apps" are always-on** (the `apps_enabled` per-scope toggle is deferred to Phase 10).
- **Dependency Warning:** `task.service.transitionTask` calls `dependencyService.assertNoOpenBlockers`
  before transitioning to a done-group status; `usp_Task_HasOpenBlockers` returns blockers not in a DONE
  group (done = `Projects.WorkflowId`→`WorkflowStatuses.Category='DONE'`, else the hardcoded names
  `Done/Resolved/Closed/Completed` — mirrors `usp_Task_Transition`). Throws `DependencyWarningError`
  (code `DEPENDENCY_BLOCKED`) → **HTTP 409** with `details.blockers`. The TS-side done-group gate uses the
  same hardcoded name set; the SP is authoritative (only returns rows when blockers are truly open).
- **Reschedule Dependencies:** `updateTask` captures before-dates, computes a **whole-DAY** delta
  (`Tasks.StartDate`/`DueDate` are SQL `DATE`), and calls `usp_TaskDependency_RescheduleDependents`
  (recursive CTE `UNION ALL` + `SELECT DISTINCT` into a PK table var — visited-safe), publishing a
  `task:event 'updated'` per shifted dependent. Best-effort (try/catch; never fails the user's update).
  Cascade is **synchronous** — BullMQ offload deferred.
- **Transitive cycle detection** in `usp_TaskDependency_Add` (recursive CTE, **workspace-scoped**,
  `MAXRECURSION 1000`; `THROW 51500` self-edge / `51501` cycle → mapped to **422**).
- **Dual surface:** REST on `taskRoutes` (`GET/POST/DELETE /tasks/:id/dependencies`) + GraphQL mirror
  (`taskDependencies` / `addTaskDependency` / `removeTaskDependency`). REST GET gated VIEW
  (`requireObjectAccess`), mutations `requirePermission('task.update')`; GraphQL VIEW via
  `requireObjectLevel` + `requireWorkspacePermission('task.update')`. Parity with watchers.
- **Roadmap delegation:** `roadmap.service` add/remove now delegate to `dependencyService` — this also
  fixed a latent bug where the legacy roadmap repo passed a `type` string into the SP's new
  `@WorkspaceId` param. `usp_Roadmap_GetItems` (gantt edges) unchanged.
- **Frontend:** `DependenciesSection` in `TaskDrawer` (Waiting-on / Blocking lists + a search picker over
  `GET /search`); the drawer status badge became a `<select>` driving a new `transitionTask` action; a
  `BlockerDialog` modal lists blockers on the 409. Drawer statuses load from `GET /lists/:id/effective-statuses`
  via `loadTaskStatuses` (default-template fallback for projects with no workflow). i18n `Dependencies`
  namespace (en/id parity).

### Review fixes (1 Critical + several) applied before merge
- **CRITICAL cross-workspace IDOR:** `dependsOnId` was not validated to share `taskId`'s workspace — an
  attacker could link a foreign task as a blocker (block another workspace's task from closing + leak its
  title/status). Fixed in BOTH the REST POST and the GraphQL `addTaskDependency` (resolve the dependsOn
  workspace, 404 on mismatch). Cycle CTE + `usp_TaskDependency_ListForTask` additionally workspace-scoped.
- **Real `/board` crash (e2e-found):** the dependencies server-action file re-exported `import type`
  bindings → Next 16/Turbopack erased them at runtime → `ReferenceError` crashed every route importing the
  actions. Removed the type re-export.
- Drawer status select switched from a hardcoded list to real effective statuses; status rollback now uses
  the current state, not a stale prop.

### Known limitations / follow-ups (not blockers)
- **Task object-level GET routes 404 when `Tasks.ListId IS NULL`** (board-created, project-scoped tasks):
  a pre-existing systemic authz pattern (`taskListId(task) ? {LIST,id} : null`) affecting deps/watchers/
  fields alike. The deps drawer shows empty for such tasks. Separate ticket: fall back to
  `{SPACE, projectId}` when `ListId` is null.
- Synchronous reschedule cascade (BullMQ offload later). `apps_enabled` toggle is Phase 10.

### Verification (local Docker `ProjectFlow_Test` + Redis)
API **268 unit / 150 integration**, web **104 unit** + i18n parity, `tsc` clean (both), `npm run build`
green, e2e `dependencies` **1/1**. Branch `feat/phase5a-dependencies` (9 commits) → ff-merged to `main`
locally (NOT pushed).

## 2026-06-06 — Phase 5b Relationships + Rollup

Spec §4; plan `docs/superpowers/plans/2026-06-06-phase5b-relationships.md`. Two new custom-field types
extending the Phase-2 system.

### Decisions
- **`relationship`** (link tasks; `targetType: 'any'|'list'`) + **`rollup`** (read-only computed aggregate).
  Migration `0035` adds the **`TaskRelationships`** link table (the **source of truth** for relationship
  values — NOT `TaskCustomFieldValues` — so reverse lookups + rollup are clean SQL) and extends
  `CK_CustomFields_Type` with both names (full prior list preserved).
- **Value writes rejected on the generic path:** `relationship`/`rollup` writes via the custom-field value
  endpoint throw `RELATIONSHIP_READONLY`/`ROLLUP_READONLY` (like `progress_auto`). Relationship values are
  set via dedicated endpoints; rollup is computed.
- **Rollup computed server-side** in `customfield.service.effectiveForTask` (the single read path the task
  panel + `taskEffectiveFields` GraphQL use) via `relationshipService.computeRollup` + the pure
  `aggregateRollup(fn, values)` (sum/avg/count/min/max/first/concat; empty → null, count → 0).
- **`validateFieldConfig`** wired into field create/update: `relationship` requires `relationshipTargetType`
  (+ `relationshipTargetListId` when `'list'`); `rollup` requires `rollupRelationshipFieldId` +
  `rollupSourceField` (FieldRef builtin|custom) + `rollupFunction`. Bad config → 422.
- **SPs:** `usp_TaskRelationship_Add/Remove/ListForField` (+ `usp_TaskCustomFieldValue_GetOne` for a single
  value read). `Add` validates both tasks + the field ∈ `@WorkspaceId` (THROW 51600–51602).
- **Dual surface:** REST `GET/POST/DELETE /tasks/:id/relationships/:fieldId` + GraphQL
  `taskRelationships`/`addTaskRelationship`/`removeTaskRelationship`. VIEW to read, `task.update` to mutate.
- **Frontend:** `FieldManager` config sub-forms for both types; `TaskDrawer` renders relationship → a
  `RelationshipField` chip picker (search via `/search`), rollup → a read-only `RollupValue`. i18n
  `Relationships`/`Rollup` namespaces (en/id parity).

### Review fixes
- **REAL crash — rollup-of-rollup recursion:** `readSourceValue` previously re-entered `effectiveForTask`
  (which recomputes all rollups) → stack overflow if a rollup's source is another rollup. Now reads the one
  custom value directly (`usp_TaskCustomFieldValue_GetOne`) and returns `null` if the source field is itself
  a `rollup`. (Also removes most of the N+1.) Fan-out capped at 500 related tasks.
- **Defense-in-depth (assessed NOT live-exploitable, hardened anyway):** the reviewer flagged the Remove/List
  SPs lacking `@WorkspaceId` as cross-workspace CRITICALs. Traced: not exploitable — every op is keyed on
  `FromTaskId = the ACL-gated route :taskId`, and a task's relationship rows are same-workspace by Add-time
  validation, so a foreign `fieldId`/`toTaskId` matches no rows. Added `@WorkspaceId` to `Remove`/
  `ListForField` + threaded it (consistency with `Add`); added the GraphQL `removeTaskRelationship`
  `toTaskId` workspace guard and a `computeRollup` foreign-relationship-field guard.

### Deferral (spec §4.8)
- `relationship`/`rollup` are **not filterable/sortable/groupable** in the Views query compiler (display
  only). Rollup shows in the **task panel**, not the Views table (the table custom-field-cell display is the
  pre-existing Phase-3 v1 deferral).

### Verification (local Docker `ProjectFlow_Test`)
API **286 unit / 161 integration**, web **104 unit** + i18n parity, `tsc` clean (both), `npm run build`
green, e2e `relationships` **1/1** (rollup shows 8 = 3+5). Branch `feat/phase5b-relationships` (6 commits) →
ff-merged to `main` locally (NOT pushed).

## 2026-06-07 — Phase 6a Engine Activation

Activates the dormant Phase 4 (`0009`) automation engine so rules actually fire. Key architectural choices recorded below.

### Architecture: typed domain-event emission (option B)

- **`emitAutomationEvent` in `automation.bus.ts`** is the sole entry point. It is called best-effort (fire-and-forget, mirroring `publishTaskEvent`) from `task.service` after commit (create → `TASK_CREATED`; `transitionTask` → `STATUS_CHANGED`; `updateTask` → `FIELD_CHANGED` / `ASSIGNEE_CHANGED`) and from `comment.service.create` → `COMMENT_POSTED`.
- **Rejected:** tapping `publishTaskEvent` directly (would have conflated realtime-UI delivery with automation dispatch — separate concerns, separate failure modes). Also rejected: an outbox-poller table (overkill for the current scale; the bus + BullMQ queue already provides at-least-once delivery with worker retry).

### `0009`-engine rewire — `enqueueForEvent` deleted

The legacy `AutomationService.enqueueForEvent` was a dead letter (never called from any service method). It has been deleted; `automation.bus#emitAutomationEvent` is the sole entry point. `automation.worker.ts` now reads `workspaceId` / `depth` / `causationChain` from the job payload and writes an `AutomationRuns` row per execution.

### `ScopeId` — maintained (non-computed) column

`ScopeId` is stored as a plain `UNIQUEIDENTIFIER` column backfilled and maintained by the SPs (`usp_AutomationRule_Create` sets it; the `GetByTrigger` hot lookup indexes on it). Rationale: SQL Server computed columns are not directly indexable in older compat levels, and the maintained column is trivially kept in sync by the two SP writers.

### `0039` taxonomy JSON rewrite — one-way, not reversed in rollback

The `UPDATE … SET TriggerConfig = REPLACE(…)` / `SET ActionConfig = REPLACE(…)` chain in `0039` rewrites the stored Jira-style enum tokens (`ISSUE_CREATED` → `TASK_CREATED`, `ISSUE_TRANSITIONED` → `STATUS_CHANGED`, etc.) in-place. The rewrite is bounded to rows that still contain an old token (idempotent re-run produces `0 rows affected`). The rollback script drops the two new tables but **does not reverse the token rewrite** — the legacy engine never fired in prod; all DB work is local-only (`ProjectFlow_Test`); and reversing would require an inverse REPLACE that risks colliding with new rows already using the new tokens.

### Loop guard: `{depth, causationChain}` + `MAX_DEPTH=5` + 10 s Redis cooldown

- `shouldEnqueue(ruleId, loop)` is a pure function: blocks if `loop.depth >= MAX_DEPTH` (5) or if `ruleId` is already in `loop.causationChain` (self-retrigger). Both produce a `loop_blocked` `AutomationRuns` row for visibility.
- A `(ruleId, taskId)` Redis SET NX EX 10 key damps tight thrash (e.g. a rule that assigns an assignee, which fires `ASSIGNEE_CHANGED`, which matches a second rule). Fails open (Redis unavailable → enqueue proceeds).
- Task-mutating actions (`ASSIGN`, `UNASSIGN`, `CHANGE_STATUS`) pass `depth+1` and the extended chain when they re-emit domain events, so the guard propagates through the causal tree.

### `CALL_WEBHOOK` — legacy `fetch` retained; signed dispatch deferred to 6c

`CALL_WEBHOOK` uses the plain `fetch` call from the original `0009` implementation. HMAC-signed dispatch (secret rotation, `X-ProjectFlow-Signature` header) is deferred to Phase 6c. This is recorded here so it is not forgotten.

### WORKSPACE-scope listing — project-keyed SP reused; full workspace listing UI deferred to 6d

`GET /automations?workspaceId=…` calls `svc.list(workspaceId)`, which passes the workspaceId into `usp_AutomationRule_GetByScope`. The automations page's project-switcher already scopes to the active project. A dedicated "workspace-wide rules" UI panel is deferred to Phase 6d.

### Review fixes applied this slice

**(a) Rollback 0038 — drop/recreate `IX_AutomationRule_Project` to restore `ProjectId NOT NULL`.**
The original 0038 rollback simply `ALTER COLUMN ProjectId … NOT NULL`, but that fails when `IX_AutomationRule_Project` (from `0009`) is defined on `ProjectId` and the column still has a NULL constraint. Fix: the down script first drops the index, restores `NOT NULL`, then recreates the index.

**(b) Worker `getRuleById` — parse the returned row.**
The worker's old `getById` returned a raw SQL row (JSON strings not parsed), so workspace-scoped rules (whose `ScopeId ≠ ProjectId`) never matched the `getByTrigger` result. Fixed: the worker now calls a typed `getRuleById` that runs the row through `parseRow` (JSON.parse of TriggerConfig / ConditionConfig / ActionConfig). Without this fix, every rule execution silently no-ops.

**(c) `ASSIGN` / `UNASSIGN` go through `usp_Task_SetAssignees`.**
The original action implementation passed `@AssigneeId` to `usp_Task_Update`, which does not have that parameter (Phase 2 replaced single-assignee with the `TaskAssignees` join table managed by `usp_Task_SetAssignees`). Fixed: ASSIGN fetches the current assignee list, appends/removes the target user, then calls `usp_Task_SetAssignees`. `SET_PRIORITY` had a stray `@AssigneeId` parameter removed at the same time.

**(d) REST `GET /automations` gained `automation.read` authz.**
The list endpoint lacked a `requirePermission` guard (any authenticated user could read any project's rules by guessing a projectId). Fixed: wrapped with `requirePermission('automation.read', { resolveWorkspace: resolveListWorkspace })`.

**(e) GraphQL `updateAutomationRule` — JSON.parse guarded.**
`updateAutomationRule` called `JSON.parse(input.triggerConfig)` without a try/catch; malformed JSON from a client would crash the resolver with an unhandled exception. Fixed: wrapped in try/catch → returns a GraphQL `BAD_USER_INPUT` error.

### DB-execution policy

ALL DB work (migrations 0038/0039, SP deploys, integration tests) ran ONLY against the local Docker `ProjectFlow_Test` instance, never the prod-pointing `apps/api/.env` (`sql.binasentra.co.id/ProjectFlow`). The classifier in MEMORY.md blocks all connections to the prod server.

## 2026-06-08 — Phase 6b Condition Engine

Replaces the 6a AND-only, stub-laden condition evaluator with a recursive **nested AND/OR** engine. **No migration, no new SP** — this slice swaps the pure evaluator the 6a worker already calls; the stored `conditions` JSON is an opaque blob to the SPs, so the richer shape flows through transparently.

### Recursive model lives in `@projectflow/types` alongside the kept legacy shape

- Added `ConditionNode = ConditionGroup | ConditionLeaf`, `ConditionGroupOp` (`'AND'|'OR'`), the exact 8-token `ConditionOperator` (`is | is_not | contains | gt | lt | before | after | is_set`), and the `isConditionGroup` type guard. The legacy `AutomationCondition` (`{type, field?, value?, pql?}`) is **unchanged** — it remains the leaf payload shape and the legacy stored form. `AutomationRule.conditions` widened to `AutomationCondition[] | ConditionNode`.
- **No data migration:** `parseConditionTree(stored)` normalises a legacy flat array to an implicit **top-level AND** group (and passes an already-tree value through by reference). Legacy `FIELD_NOT_EQUALS → operator 'is_not'`; `IN_SPRINT`/`NOT_IN_SPRINT → {field:'sprintId', operator:'is_set'}` (the negation for `NOT_IN_SPRINT` is applied in the leaf evaluator, not encoded as a sentinel value).

### Pure, injected-resolver evaluator (IO stays at the worker boundary)

- `evaluateConditionTree(node, ctx): Promise<boolean>` in `condition.tree.ts` is pure: AND = every child, OR = any child, **empty group = vacuously true** (matches the legacy "no conditions → always fire" semantics, for BOTH AND and OR). The two leaf kinds that need data are supplied as async resolvers on `ConditionContext` (`matchesFilter`, `userHasRole`), so the tree-walk + `compareOperator` are fully unit-testable in isolation. `compareOperator` is the single source of operator truth; numeric/date operators are finite-guarded (never throw); `contains` **fails closed** on an empty/missing expected (an empty `value` must not match everything).
- `ISSUE_MATCHES_FILTER` reuses the existing PQL parser (`modules/search/pql.parser.ts#parsePQL`) and matches the parsed filter against the event's task **in memory** (no DB round-trip) — fast, deterministic, and it resolves `currentUser()` against the event actor. Supported match fields are the `ParsedPQL` subset (`status/priority/type/assigneeId/reporterId/sprintId`, free-text `q` over the title, `dueAfter/dueBefore`). The matcher **fails closed** on filter clauses it cannot evaluate in memory (`createdAfter/updatedAfter/openSprints/projectKey`) — it returns false rather than silently dropping the clause and over-firing (sort directives `orderBy/orderDir` are correctly ignored). This was hardened in the final review, since 6a's `ISSUE_MATCHES_FILTER` was a `return true` stub that never evaluated PQL at all.
- `USER_HAS_ROLE` reuses `roleService.listUserRoles(userId, workspaceId)` (RBAC) and **fails closed** (returns false, does not call the service) when there is no actor. The role check is scoped to the rule's **workspace**: the 6a job payload carries `actorId` but NOT `workspaceId`, so the worker passes the authoritative `job.data.workspaceId` into `buildConditionContext(payload, { workspaceId, actorId })` via an explicit `opts` arg.

### Worker change is a minimal swap (not the plan's full rewrite)

The 6a worker already loads the rule via `getRuleById`, wraps the whole job in an `AutomationRuns` audit, and records a **`skipped`** run when conditions fail. So the only change is: `evaluateConditions(rule.conditions, payload)` → `await evaluateConditionTree(parseConditionTree(rule.conditions), buildConditionContext(payload, { workspaceId, actorId }))`. The legacy `evaluateConditions`/`evaluateOne` (with the `ISSUE_MATCHES_FILTER`/`USER_HAS_ROLE → return true` stubs) is **deleted**; `automation.conditions.ts` is now a thin re-export of the tree engine (the worker was its only caller).

### Resolver-error guard (review-added) — preserve the audit trail

Because the evaluator now `await`s real IO (a `USER_HAS_ROLE` check hits the DB), a resolver rejection could escape the job handler uncaught — BullMQ would fail the job with **no audit row**, a silent-failure regression vs. the old never-throwing sync evaluator. The worker now wraps the eval in try/catch: a resolver error records a **`failed`** `AutomationRuns` row (preserving observability) and **rethrows** so BullMQ retry semantics are kept. Only rules using `ISSUE_MATCHES_FILTER`/`USER_HAS_ROLE` touch a resolver; FIELD-only rules cannot reject.

### Route schema widened to accept a tree (backward compatible)

`automation.routes.ts` `conditions` validation became `z.union([z.array(conditionSchema), conditionNodeSchema])` on BOTH create and update, where `conditionNodeSchema` is a `z.lazy` recursive union of `{op:'AND'|'OR', children:[...]}` and a leaf. The leaf `conditionSchema` gained an optional `operator` enum (so a flat array WITH operators also validates; pre-operator legacy data still passes because it is optional). The route stores `conditions` opaquely (`JSON.stringify` → `ConditionConfig NVARCHAR(MAX)`); no array-specific handling. The repository's `parseRow` cast was broadened from `as AutomationCondition[]` to `as AutomationCondition[] | ConditionNode` to match.

### Frontend — nested AND/OR builder

`automations-view.tsx`'s flat `ConditionList` was replaced with a recursive `ConditionGroupEditor` + `ConditionLeafEditor` (AND/OR toggle, add-leaf, add-nested-group, remove; per-leaf operator dropdown; PQL/role inputs force `operator:'is'`). Dialog state moved from `AutomationCondition[]` to a `ConditionNode` tree, seeded from existing rules via a client mirror `lib/conditionTree.ts#parseConditionTreeClient` (legacy array → implicit AND). The `RuleRow` badge counts leaves tree-safely via `countLeaves` (the old `conditions.length` would crash on a tree object). The submit payload still sends `scopeType/trigger/actions/name` alongside the tree `conditions`; the server action forwards it opaquely (its `conditions` type tightened to `AutomationCondition[] | ConditionNode`). i18n: 13 new keys (operator labels, AND/OR group labels, PQL/role placeholders) in **en + id** (real Indonesian), parity green.

### Deviations from the plan (recorded per DoD)

- **Worker:** the plan's Task 5 supplied a full worker rewrite using `repo.list(projectId)`; the real 6a worker uses `getRuleById` + an existing `recordRun` audit, so only the eval call was swapped (full rewrite ignored).
- **Integration test:** the plan assumed `emitAutomationEvent`/`drainAutomationJobs` test helpers — they don't exist. `or-group.integration.test.ts` instead follows 6a's direct-call style: create an OR-group rule via the real `POST /automations`, read it back with `getRuleById` (proving the tree survives the SP JSON round-trip), then evaluate the tree against three payloads (fire HIGH / fire Blocked / skip neither). 4 assertions, **live-green**.
- **E2E:** the plan's Task 9 was a fragile UI builder round-trip; replaced with an **API-driven** `e2e/automation-conditions.spec.ts` (at repo-root `e2e/`, not `apps/next-web/e2e/`) that proves §5.5 end-to-end through the live BullMQ worker — two rules on one `STATUS_CHANGED→Done` transition: an OR group whose `status is "Done"` branch matches records **`success`** (+ASSIGN landed), an OR group matching neither branch records **`skipped`**. The builder UI itself is covered by web unit tests (same rationale 6a used).

### Known limitations / follow-ups (pre-existing, not 6b regressions)

- **Event-payload field coverage.** `buildEventPayload` (automation.bus.ts) only surfaces a few keys per trigger (`STATUS_CHANGED → status/fromStatus/toStatus`; `ASSIGNEE_CHANGED → assigneeId`; `FIELD_CHANGED → field/from/to`; `TASK_CREATED → reporterId`). A FIELD condition on a field the trigger doesn't carry (e.g. `priority` on a `STATUS_CHANGED` rule) resolves to unset → the condition fails. This is a 6a limitation, unchanged here, but 6b makes it more reachable (free-text field box + OR groups). Follow-up: enrich the payload with a full task snapshot, or constrain the UI field box to the selected trigger's fields. The `or-group` integration/e2e prove the engine logic by exercising the `status` field (which the `STATUS_CHANGED` payload DOES carry) for the firing branch.
- **Recursion depth.** `conditionNodeSchema` (zod) and `evaluateConditionTree` are unbounded-depth; gated behind `automation.create/update` permission (authenticated workspace member only). A depth/size cap is a reasonable future hardening.

### DB-execution policy

The one integration test + the e2e ran ONLY against local Docker `ProjectFlow_Test`, never the prod-pointing `apps/api/.env`. Verified this slice: **API 380 unit / 186 integration (45 files), web 104 unit + en/id parity, both builds clean, e2e `automation-conditions` 1/1.**

## 2026-06-08 — Phase 6c (Actions · Scheduler · Signed Webhooks)

Expands the automation engine with six new action types, per-action delay, a time-based scheduler sweep, and audited/signed outgoing webhooks. **No migration** — 6c reuses existing tables (`Tasks`, `Tags`/`TaskTags`, `TaskCustomFieldValues`, `Templates`, `AutomationRules`, the 6a `AutomationRuns`). Migrations on disk stay at the 6a/6b high-water mark; local Docker `ProjectFlow_Test` remains at **0039**.

### No migration; two new read-only scheduler SPs

The only new SQL is two READ-ONLY stored procedures:

- **`usp_AutomationRule_ListDueDateRules`** — window join: tasks whose `DueDate` crossed `(@Since, @Now]`, one row per rule×task. Uses `JSON_VALUE(TriggerConfig,'$.type')` to identify due-date triggers because `AutomationRules` has **no `TriggerType` column** (the plan assumed one; caught at deploy against `ProjectFlow_Test`). Scope predicate mirrors `usp_AutomationRule_GetByTrigger` exactly: `PROJECT → r.ScopeId = t.ProjectId`, `WORKSPACE → r.ScopeId = t.WorkspaceId`.
- **`usp_AutomationRule_ListScheduledRules`** — returns enabled `SCHEDULED` rules (same `JSON_VALUE` derivation, no column). Each rule's cron string is evaluated in the application layer by `cron-parser`.

### Six new actions — delegated, no raw table writes

All six new action types delegate to existing service methods rather than writing SQL directly:

- **`SET_FIELD`** → `customFieldService.setValue`
- **`ADD_TAG`** → `tagService.linkTask(tagId)` when given a tag ID, or `tagService.resolveOrCreate(spaceId, name)` then link when given a `tagName` (space id = `ctx.projectId`)
- **`CREATE_TASK` / `CREATE_SUBTASK`** → `TaskRepository.create`; `CREATE_SUBTASK` parents the new task to the trigger task
- **`MOVE_TASK`** → `taskService.moveTask` + `publishTaskMove`; `taskService.moveTask` dispatches the outgoing webhook but does **not** publish the live board event, so the executor explicitly calls `publishTaskMove` after
- **`APPLY_TEMPLATE`** → `templateService.apply(templateId, { targetParentId: listId, anchorDate }, actor)`

All actions run as the resolved actor `resolveActor(ctx) = payload.actorId ?? process.env.SYSTEM_USER_ID`. There is **no seeded system user**; `SYSTEM_USER_ID` is an optional env var — if absent, actions that require an actor will surface null-actor errors.

### Executor signature unified to 2-arg (`action`, `ctx`)

`executeAction(action, ctx: ActionContext)` where `ActionContext = { ruleId, workspaceId, projectId, loop: { depth, causationChain }, payload }` lives in the new `automation.actions.context.ts`. This replaces 6a's 3-arg `(action, payload, { workspaceId, projectId, loop })`. The worker constructs this ctx before calling the executor.

### Loop-guarded re-emit, constrained to the 6a bus union

`reEmit(ctx, event)` stamps `loop = { depth + 1, causationChain: [...chain, ruleId] }` and calls the 6a `emitAutomationEvent`. It only emits event types that exist in the `AutomationDomainEvent` discriminated union:

| Action | Re-emitted as |
|---|---|
| `SET_FIELD` / `SET_PRIORITY` | `FIELD_CHANGED` |
| `CHANGE_STATUS` | `STATUS_CHANGED` |
| `ASSIGN` / `UNASSIGN` | `ASSIGNEE_CHANGED` (`UNASSIGN` re-emits `{ from: null, to: null }`; legacy did not) |
| `CREATE_TASK` / `CREATE_SUBTASK` | `TASK_CREATED` |
| `MOVE_TASK`, `ADD_TAG`, `POST_COMMENT`, `SEND_NOTIFICATION`, `CALL_WEBHOOK`, `APPLY_TEMPLATE` | no re-emit (no matching union member) |

A local `emitDeeper` wrapper in `automation.actions.ts` works around `Omit<AutomationDomainEvent, 'loop'>` collapsing the discriminated union to its common keys (per-member required fields like `STATUS_CHANGED.toStatus` were lost when passing through `Omit`). The canonical `reEmit` param should be made distributive in a later cleanup.

### PascalCase bug caught in review

`CREATE_TASK` / `CREATE_SUBTASK` read the `TaskRepository.create` result casing-tolerantly — `(created as any)?.id ?? .Id` — because the repo returns a PascalCase `SELECT *` row while the `Task` TS type declares camelCase. The initial code's re-emit guard was always false (the `TASK_CREATED` re-emit never fired). The unit-test mock was tightened to the real PascalCase shape so it genuinely guards the contract. Same recurring bug-class noted in prior phases (Phase 3.5 deferred-item cleanup, live-board e2e).

### Per-action delay — fixed a latent infinite-loop in the plan's contract

`nextDelayedSlice(actions, fromIndex, prepaidStart = fromIndex > 0)` partitions the ordered action list into `runNow` + `resumeAt` + `delayMs`. The worker passes `prepaidStart = (job.data.actionIndex !== undefined)` and re-enqueues the remaining actions as a BullMQ `DELAYED` job carrying `actionIndex` plus the unchanged `depth` / `causationChain`.

**The plan's contract had a latent infinite-loop:** on a leading-delay action, `resumeAt: 0` would re-defer back to index 0 forever. The `prepaidStart` flag (true on any resume, including `resumeAt: 0`) makes the resumed start index run instead of re-defer. Conditions are evaluated only on the first pass, not on delayed resumes.

Minor accepted residual: a first pass that is fully deferred (all actions have a leading delay) writes a `status: 'success'` audit run that executed 0 actions; `executionCount` is bumped only on the terminal non-deferred slice. The zero-action run is traceable via `actionResults.slice`.

### Signed `CALL_WEBHOOK` — rerouted through `webhookOutgoingService`

`CALL_WEBHOOK` now dispatches through `webhookOutgoingService.dispatch(workspaceId, event, payload)` (HMAC-SHA256 `X-ProjectFlow-Signature`, BullMQ retries, `WebhookDeliveries` record). The prior raw fire-and-forget `fetch` was deleted; the unit test spies `globalThis.fetch` to assert it is **never called**.

**Follow-up:** the outgoing-webhook subscription event enum does not include `'automation.fired'` (the action's default event). A working `CALL_WEBHOOK` must currently target a subscribable event (`issue.created/updated/deleted`, `sprint.started/completed`, `comment.created`, `member.invited`). Add `'automation.fired'` to the enum or change the action default in a follow-up.

### Scheduler — direct-enqueue, not via the bus

A BullMQ repeatable job (`automation-scheduler` queue, `upsertJobScheduler` every 5 min) mirrors `recurrence.worker.ts`. The exported `runScheduledSweep(now, since)` is pure; a Redis last-sweep cursor (`automation:scheduler:lastSweepAt`) is maintained via the existing `getRedis()` singleton.

**Design deviation from the plan's "enqueue through the 6a bus":** the `AutomationDomainEvent` union has no `DUE_DATE_PASSED` / `DATE_ARRIVED` / `SCHEDULED` variants, and `SCHEDULED` rules can't fan-out via `getByTrigger` (each rule has its own cron). The sweep therefore enqueues **directly** to `automationQueue` — one job per due rule×task for due-date rules, one job per `SCHEDULED` rule whose cron window elapsed. The 6a worker then loads the rule, evaluates 6b conditions, runs actions, and records the `AutomationRuns` audit row uniformly.

Additional scheduler details:

- **Cooldown** is NOT applied to scheduler enqueues — accepted residual; the `(since, now]` window + cron gate deduplicate per crossing.
- **`DATE_ARRIVED`** uses `DueDate` as the target date; a config-named date field is deferred.
- **Cron evaluation** uses `cron-parser` v4.9.0: `import parser from 'cron-parser'; parser.parseExpression(cron, { currentDate, tz: 'UTC' })`.

### Types widened (backward compatible)

`webhookUrl?` was **kept** (legacy field; not removed contra the plan) and `webhookEvent?` **added**, alongside the six new action tokens, per-action config fields, and `delaySeconds`. The REST `actionSchema` was widened to accept all new fields.

### Dev endpoint for e2e

`POST /api/v1/dev/automation/sweep` triggers one `runScheduledSweep()` call so the e2e doesn't wait for the 5-min repeatable timer. Guarded: returns **404** when `NODE_ENV === 'production'`; requires Bearer auth otherwise.

### DB-execution policy

All DB work (SP deploy, integration tests, e2e) ran ONLY against local Docker `ProjectFlow_Test`, never the prod-pointing `apps/api/.env`. Verified this slice: **API 399 unit / 193 integration (46 files, 266 SPs deploy 0 fail), web 104 unit + en/id parity, both builds clean, e2e `automation-scheduler` 1/1** (DUE_DATE_PASSED fires via the sweep within its window, CALL_WEBHOOK run audited).

## 2026-06-06 — Phase 5c Recurring Tasks

Spec §5; plan `docs/superpowers/plans/2026-06-06-phase5c-recurring.md`.

### Decisions
- **`TaskRecurrences`** (migration `0036`): rule JSON (`[Rule]` bracketed — reserved word) + `RegenerateMode`
  (`on_complete`|`schedule`|`both`) + `NextRunAt` + `Active` + `LastSpawnedTaskId` + `IncludeDependencies`;
  a filtered UNIQUE index (one active recurrence per task) + an `(Active, NextRunAt)` sweep index.
- **`computeNextOccurrence`** pure (daily/weekly`[byWeekday]`/monthly`[byMonthday` month-end clamp`]`/yearly,
  interval, `endsAt`). **Weekly+interval uses from-anchored active-week semantics**: `from` is the previous
  occurrence, so same-week later weekdays (`weeksAhead=0`) are the correct next occurrence; jumps of N weeks
  must be interval-aligned. `validateRule` → 422. `count` is caller-enforced.
- **`spawnNext` claim-first:** an ATOMIC conditional `usp_TaskRecurrence_AdvanceAfterSpawn`
  (`WHERE Active=1 AND NextRunAt=@ExpectedNextRunAt`, count-decrement folded into the same UPDATE) claims the
  occurrence; only the winner clones. Clone = `usp_Task_Create` (title/desc/type/priority/list/estimate,
  dates remapped preserving start→due duration, status reset to the list's first effective status) + copy
  custom-field values (SKIP relationship/rollup/progress_auto), assignees, watchers, tags; dependency edges
  only when `IncludeDependencies`. `publishTaskEvent('created')`. Subtask/checklist cloning deferred (v1).
- **Triggers:** on-complete in `transitionTask` (only when crossing **into** a done-group status from a
  non-done status; fire-and-forget try/catch, never faults the transition) + a scheduled **BullMQ**
  `recurrence-sweep` worker (15 min; `usp_TaskRecurrence_ListDue` = schedule|both, error-isolated per row)
  bootstrapped next to the oauth worker (Redis-gated; on-complete works without Redis).
- **Dual surface:** REST `GET/PUT/DELETE /tasks/:id/recurrence` + GraphQL
  `taskRecurrence`/`setTaskRecurrence`/`clearTaskRecurrence`. VIEW read / `task.update` mutate; null workspace
  → 404. **Frontend:** `RecurrenceEditor` in `TaskDrawer` (freq/interval/weekday/monthday/end-condition/mode/
  carry-deps) + a drawer recurring badge (drawer-only — recurrence state isn't on list/board payloads). i18n
  `Recurrence` en/id.

### Review fixes
- **REAL — double-spawn + count-decrement race:** on-complete + the scheduled sweep (mode `both`) could both
  spawn from one occurrence (and both decrement count) because `AdvanceAfterSpawn` was last-writer-wins. Fixed
  by the atomic claim above (only one path wins; the loser returns without spawning).
- **REAL — idempotency:** `transitionTask` re-spawned on Done→Done / Done→Resolved; now only the first
  into-done crossing spawns.
- **Past-due seed** clamps `NextRunAt` to the future. Minors: `Math.floor` week-delta; assignee-copy warn log.
- **Reviewer's "CRITICAL" weekly-interval claim was assessed NOT a bug** (from-anchored semantics; the
  proposed `weeksAhead>0` fix would break interval=1 same-week) — code kept, 5 pinning unit tests added.

### Deferrals
Subtask/checklist cloning (v1); per-user timezone (server dates); `apps_enabled` (Phase 10).

### Verification (local Docker `ProjectFlow_Test` + Redis)
API **320 unit / 170 integration**, web **104 unit** + i18n parity, `tsc` clean (both), `npm run build`
green, e2e `recurring` **1/1**. Branch `feat/phase5c-recurring` (6 commits) → ff-merged to `main` locally
(NOT pushed).

## 2026-06-06 — Phase 5d Templates

Spec §6; plan `docs/superpowers/plans/2026-06-06-phase5d-templates.md`. Save a task/list/folder/space as a
reusable snapshot and apply it elsewhere.

### Decisions
- **`Templates`** (migration `0037`): scoped (`TASK|LIST|FOLDER|SPACE`) JSON `Snapshot` = subtree + settings;
  **dates stored as day-offsets** from an anchor (earliest start/due in the subtree, else now). Each snapshot
  node has a stable `nodeId` (path-like) for import-selection.
- **Capture** (`template.service`) composes EXISTING reads — `usp_Hierarchy_DescendantTasks`, folder/list
  lists, custom-field DEFINITIONS + `effectiveForTask` VALUES (skips `relationship`/`rollup`/`progress_auto` —
  non-portable), tags, SHARED saved views. **Assignees dropped** (user-specific). Two minimal read SPs added
  (`usp_List_GetById`, `usp_View_ListForScope`).
- **Apply** (`template.apply`) recreates the subtree via existing create paths (project/folder/list/task +
  custom-field create + `usp_View_Create`) with fresh ids + rebuilt `Path`; **per-list old→new field-id remap**
  (orphan values skipped); **date remap** (due via `usp_Task_Create`, start via `usp_Task_UpdateDates` — the SP
  has no `@StartDate`); tag reuse; subtask recursion; **import-selected** (a node is recreated iff it or a
  descendant is selected — required ancestors kept); **cross-workspace target guard → 404**; best-effort
  additive (no rollback). Recreated tasks default to `'To Do'` (no status in the snapshot).
- **Dual surface:** REST `/templates` CRUD + `POST /:id/apply` + GraphQL. Capture → VIEW on source; apply →
  create-permission at the target + workspace match; list/get/delete → workspace-scoped. **Frontend:**
  save-as-template on the sidebar (space/folder/list) + task drawer; a scope-aware apply modal (target picker +
  anchor date); a Template Center at `/templates` + nav entry. i18n `Templates` en/id.

### Real bugs found by the e2e/review (fixed)
- **CRITICAL — `/templates` REST routes were UNAUTHENTICATED** (the route group was mounted without
  `authMiddleware` → every endpoint saw `userId: null` → 401; integration tests missed it by calling the
  service directly). Added `app.use('/templates/*', authMiddleware)`.
- **Template Center always empty** — `listTemplates()` omitted the required `workspaceId` query param.
- **Re-delete returned 200** — `usp_Template_Delete` now returns a row only when this call deleted it (and drops
  `Snapshot` from the projection) → repeat delete 404s. **`anchorDate` validated** (REST + GraphQL → 422 instead
  of silently nulling every remapped date).

### Deferrals
Item-selection UI (apply-all default; backend accepts `selectedItemIds`; REST `getById` omits the snapshot —
only GraphQL `template.snapshot` exposes it); recreated-task status `'To Do'`; assignees dropped; TASK-scope CF
values reapply only on the same list; folder-capture over-fetches the space's lists (perf, no data leak).

### Verification (local Docker `ProjectFlow_Test`)
API **334 unit / 178 integration**, web **104 unit** + i18n parity, `tsc` clean (both), `npm run build` green,
e2e `templates` **1/1** (deps/relationships/recurring still green). Branch `feat/phase5d-templates` →
ff-merged to `main` locally. **Phase 5 (5a–5d) then PUSHED to origin/main.**

---

## 2026-06-09 — Phase 6d (Template Gallery · Run History · Metering)

Phase 6d closes the final automation slice: an 18-template in-code catalog with a gallery UI, run-history drawer, and per-workspace monthly metering.

### Reconciliation: run-history was already complete in 6a

`GET /automations/:id/runs` (offset pagination, `{ runs }` envelope), the GraphQL `automationRuns` field, `svc.listRuns`, `repo.listRunsByRule`, `usp_AutomationRun_ListByRule`, and the `AutomationRun`/`AutomationRunStatus` types were all built in Phase 6a. 6d REUSES them unchanged (offset `= runs.length` for drawer "Load more"). No keyset SP, no new route, no new type was added for run history. The only new SP is `usp_AutomationUsage_GetCurrent` (read-only monthly counter); local Docker `ProjectFlow_Test` stays at migration **0039**, SP count **267**.

### 18-template in-code catalog

`automation.templates.ts` defines 18 templates (catalog keys: `auto-assign-on-create`, `webhook-on-done`, etc.) in the 15–20 band. The gallery PRE-FILLS the create-rule dialog with the template's `name`, `trigger`, `conditions`, and `actions`. **No tenant rows are seeded** — the catalog is static code, served via `GET /automations/templates`.

---

## 2026-06-12 — Phase 8c (Sprints / Agile)

Re-models flat per-Project `Sprints` into the Phase-1 hierarchy: a Sprint becomes a **List under a sprint-flagged Folder**, with cadence-driven auto-start/auto-complete/auto-roll-forward and per-assignee story-point rollups. The legacy `Tasks.SprintId` denorm is retained (maintained) so existing reports/automation keep working.

### Migration renumber (plan predated 8a/8b)

The plan (2026-06-07) used `0045_sprint_folders` / `0045b`, but `0044`/`0045` were taken by Phase 8b timesheets. Renumbered to **`0046_sprint_folders.sql`** (schema: `Folders.IsSprintFolder`, `SprintSettings` 1:1 with the sprint Folder, `Sprints.ListId`/`FolderId` + `UQ_Sprint_List` filtered-unique + `IX_Sprint_Folder`), **`0046b_sprint_data_migration.sql`** (idempotent legacy fold, local-Docker only), and **`0047_sprint_manage_perm.sql`** (RBAC seed). Local Docker `ProjectFlow_Test` advances **0045 → 0047**; SP count **319 → 325** (+6: `usp_Folder_Set/GetSprintSettings`, `usp_Sprint_CreateInFolder/RollForward/GetPointsRollup/ListDueFolders`; `usp_Report_SprintSummary` modified; `usp_Folder_GetWorkspaceId` already existed and is reused with its `@Id` param, NOT recreated).

### `sprint.manage` is seeded NOW (not deferred) — the 8b fail-closed lesson

The plan invented a `sprint.manage` slug for folder-settings + roll-forward but only noted it as an "RBAC seed follow-up". `requirePermission` fail-closes (403) on an unseeded slug — exactly what bit Phase 8b's `timesheet.*`. So **0047 seeds `sprint.manage`** into `Permissions` + grants it to `workspace-owner` + `workspace-admin` (the management tier, mirroring `sprint.delete` from 0019). The REST integration test runs as the workspace **owner** (no super-admin bypass) to prove the seed end-to-end, plus a non-member → 403 negative test.

### Roll-forward keys on source-List membership, NOT `SprintId` (headline correctness)

The existing `usp_Sprint_Complete` already **nulls `SprintId`** on unfinished tasks at completion (leaving `ListId` intact). The plan's `usp_Sprint_RollForward` matched `WHERE SprintId = @FromSprintId`, which would roll **zero** tasks after an auto-complete (the sweep completes BEFORE rolling forward). Fix: roll-forward matches `WHERE ListId = @FromListId` — the List is the authoritative membership signal in the sprint-folder model (1:1 sprint↔List via `UQ_Sprint_List`). DONE-category / resolved / soft-deleted tasks are excluded. A `THROW 50048` guards a NULL source List (Batch-B review). This is validated at three layers: the isolated `usp_Sprint_RollForward` test, the `sprintService` test (start→complete→rollForward), and the `runSprintSweep` integration + e2e.

### truncate.ts FK reorder (would have broken the WHOLE integration suite)

`0046`'s new `Sprints.ListId→Lists` / `Sprints.FolderId→Folders` FKs mean `Lists`/`Folders` can no longer be deleted before `Sprints`. `truncateAll`'s order was `Lists → Folders → Sprints`; moving `SprintSettings` + `Sprints` **before** `Lists`/`Folders` is mandatory or every integration test's `beforeEach` fails FK 547. (The reconciliation flagged the missing-`SprintSettings` gap; the Sprints-ordering break from the new FKs was caught at first migrate.)

### PascalCase landmine — GraphQL `createSprintInFolder` normalizes the row

`usp_Sprint_CreateInFolder` returns a raw `SELECT *` (PascalCase) row, but `SprintType` uses `t.exposeString('id')` (camelCase). The mutation resolver **normalizes** the row to the camelCase `SprintShape` so the exposeString resolvers resolve (the pre-existing `sprints` query, which returns raw `usp_Sprint_List` rows, is likely already casing-broken for `id`/`status` — left as a pre-existing issue, out of scope). New `SprintType.listId/folderId/points` resolvers are case-tolerant (`s.x ?? s.X`).

### Final whole-slice review — two cross-tenant write holes caught + fixed

The final opus review found the exact class of bug prior slices' final reviews caught:
- **C1 — GraphQL `createSprintInFolder`/`rollForwardSprint` gated on `requireAuth` only**, ignoring the codebase's enforced GraphQL-authz convention (`graphql/authz.ts` → `requireWorkspacePermission`, mirrored by every other recent module). Any authenticated user could write into another tenant's folder/sprint. **Fixed:** both mutations now `await requireWorkspacePermission(ctx, <folder/source-sprint workspaceId>, 'sprint.create' | 'sprint.manage')` (workspace resolved via new `sprintService.getFolderWorkspaceId`/`getSprintWorkspaceId`); + a non-member→FORBIDDEN GraphQL test.
- **C2 — roll-forward never validated the TARGET sprint shares the source's workspace** (REST middleware only resolved the source `:id`), so tasks could be teleported across tenants. **Fixed at the data layer** (covers REST + GraphQL + the worker uniformly): `usp_Sprint_RollForward` now `THROW 50049` when the source and target Lists' `WorkspaceId` differ; REST maps 50049 → 422; + an SP-level cross-workspace negative test.

### Accepted residuals / documented follow-ups

- **Data migration `0046b` is local-Docker-only**; a production cutover runbook is deferred (spec §10.6).
- `usp_Sprint_GetPointsRollup` / `usp_Report_SprintSummary` membership use `(@ListId IS NOT NULL AND t.ListId=@ListId) OR t.SprintId=@SprintId` — the `OR SprintId` is a **mid-migration fallback**; once all sprints are List-bound it is redundant (1:1 `UQ_Sprint_List` precludes double-count in steady state). Remove the fallback in a later cleanup.
- Per-assignee rollup excludes unassigned tasks' points (they appear in the total but not the per-assignee sum) — by design.
- Test/dev-only `POST /sprints/_sweep` (NODE_ENV `!== 'production'` guard) lets the e2e drive the scheduler deterministically; never mounted in prod.
- The two web components (`SprintSetup`/`SprintList`) are built + unit-tested but **not yet wired to a page route** (the plan specified no `page.tsx`) — a surfacing follow-up, mirroring the 8b page-route follow-up.
- **Pre-existing (out of scope, noted):** `scripts/db-migrate.ts` records `MigrationHistory` outside the per-migration transaction (a crash between record + commit could skip a migration); `usp_Sprint_Complete` has no `BEGIN TRANSACTION` and uses unqualified table names. None are 8c regressions.

### Verification (local Docker `ProjectFlow_Test`)

Migrations reversible (rollback drops auto-named FK + default constraints before columns) + idempotent; **API 482 unit / 245 integration (57 files, incl. 2 cross-tenant negative-authz tests from the final review), web 139 unit + en/id parity, apps/api tsc + next build clean, `sprint-agile` e2e 1/1** (auto-complete → next sprint created → task rolled forward → points ≥ 5). All DB work ran ONLY against local Docker.

### Shared `ruleShapeSchema` and pre-existing route bug fixed

`ruleShapeSchema` (the Zod shape shared by create + update + the catalog integrity test) was lifted verbatim from `automation.routes.ts` into `automation.templates.schema.ts` (single source of truth). This lift also **fixed a pre-existing 6a route bug**: `triggerSchema` lacked the `field` key, so a `FIELD_CHANGED` rule's `trigger.field` was silently stripped on save (the route validated and persisted a `trigger` without `field`). The fix adds `field: z.string().optional()` to `triggerSchema`; a new integration round-trip test covers the before/after.

### Dual i18n source

`TEMPLATE_STRINGS` (API-side, keyed by catalog key) drives `GET /automations/templates` localization via `Accept-Language` (prefix `id` → Indonesian, otherwise English). The web `Automations` namespace keys drive the in-app gallery (card title/description rendered client-side). Kept in parity by the catalog unit test + `messages.unit`.

### Run-history paging

OFFSET-based, reusing the 6a `GET /:id/runs?limit=&offset=` route (newest-first). The `RunHistoryDrawer` "Load more" button pages by `offset = runs.length`. No new SP or route.

### Authorization

`GET /automations/templates` and the GraphQL `automationTemplates` field are **auth-only** (static catalog; the global `authMiddleware` on `/automations/*` covers them). `GET /automations/usage` + `GET /:id/runs` + GraphQL `automationUsage`/`automationRuns` are **workspace-gated** (`automation.read` / `automation.update`), fail-closed.

### Metering — read-only, no enforcement

`usp_AutomationUsage_GetCurrent` returns `{ workspaceId, period, runCount }` where `period` is UTC `'YYYYMM'` (matching the worker's `CONVERT(CHAR(6), SYSUTCDATETIME(), 112)` write format). The "Runs this month" KPI tile on `/automations` is display-only. Enforcement (rate limiting, plan gating) is deferred to Phase 10.

### e2e split (deviation from plan's single UI-flow spec)

The plan described a single UI-flow e2e. The delivered spec has two tests:

- **TEST 1** (API-driven): templates localization + instantiation + TASK_CREATED→ASSIGN fire + BullMQ run-history poll + metering — over the real HTTP+worker stack, matching the existing automation e2e convention. The worker timing is best proven by polling over the API (as automations.spec.ts and automation-scheduler.spec.ts do).
- **TEST 2** (browser): gallery dialog renders ≥15 cards, "Use template" pre-fills the create-rule name input. Worker-independent (the run-history/worker path is covered by the integration tests + TEST 1).

Rationale: the project convention prefers robust API-driven e2e over fragile UI selectors; splitting avoids a slow, flake-prone single test that mixes UI waits with BullMQ timing.

### DB-execution policy

All DB work ran ONLY against local Docker `ProjectFlow_Test`, never the prod-pointing `apps/api/.env`. SP count: **267** (one new: `usp_AutomationUsage_GetCurrent`). Migration level: **0039** (unchanged).

**This is the final Phase 6 slice — the Phase 6 automation arc is code-complete.**

---

## 2026-06-09 — Phase 6c follow-ups resolved

The three documented Phase 6c follow-ups are now done (branch `feat/phase6c-followups` off `efad4a0`; 3 commits `a4e054a`→`17ec370`; ff-merged to `main` locally, tip `17ec370`, +46 ahead of origin, **NOT pushed**, branch deleted).

- **`automation.fired` is now a first-class outgoing-webhook event** — added to the `OutgoingWebhookEvent` union (`packages/types`), the API `VALID_EVENTS` zod enum (`webhook-outgoing.routes.ts`), the `WebhookManager` subscription UI (`ALL_EVENTS`; `descKey` made optional + render guarded so the desc-less event doesn't call `t(undefined)`), and the automation builder's `WEBHOOK_EVENTS` selector (placed first as the natural default). No migration (events are JSON; no DB CHECK). The 6c CALL_WEBHOOK default event now actually delivers.
- **Scheduler-origin condition evaluation is hydrated** — new pure `taskToPayloadFields(task)` (`condition.context.ts`; casing-tolerant PascalCase/camelCase, assignee from array-or-comma-string first element, null-safe; +8 unit tests). The worker, on the first pass only and when the payload carries a `taskId`, loads the task and builds `{ ...taskToPayloadFields(await taskRepo.getById(taskId)), ...payload }` for condition eval (payload wins; `ActionContext.payload` for actions stays the original). So DUE_DATE_PASSED/DATE_ARRIVED rules with FIELD/PQL conditions now match real data instead of failing closed on null fields.
- **`reEmit` param is now distributive** — exported `DomainEventNoLoop` (distributive `Omit` over the `AutomationDomainEvent` union) is the canonical `reEmit` param; the local `emitDeeper` workaround in `automation.actions.ts` was deleted and its 7 call sites call `reEmit` directly (0 `emitDeeper` left).

Verified live on Docker `ProjectFlow_Test`: API **407 unit** (+8), web **104 unit**, `tsc` + both builds clean, e2e `automation-scheduler` **1/1** — the spec was strengthened to prove BOTH new behaviors: the webhook subscribes to `automation.fired` and the CALL_WEBHOOK action fires it, and the DUE_DATE_PASSED rule carries an `ISSUE_MATCHES_FILTER` `priority = HIGH` condition that only matches because the worker hydrates the task's fields (without #2 it would fail closed → run skipped → test fail). Observed e2e log noise (not failures): `rule disabled or deleted` from stale prior-run queue jobs, and `fetch failed` / `LogDelivery FAILED` from the deliberately-unreachable webhook sink + a delivery-after-teardown race (pre-existing; the webhook-outgoing delivery/logging code was not changed).

## 2026-06-09 — Phase 7a (Collaboration foundation + Docs & Wikis)

The keystone of Phase 7: stood up the app's **first realtime CRDT collaboration channel** (it had only SSE before) and shipped Docs & Wikis on top. Branch `feat/phase7a-collab-docs-wikis` off `490d244`; 14 commits; verified live on Docker `ProjectFlow_Test`: **API 430 unit / 206 integration, web 108 unit (+ en/id parity), both builds clean, e2e `docs-collab` 3/3 live** (two-browser co-edit + live cursors + offline CRDT merge; history restore; wiki flag). All DB work ran ONLY against local Docker `ProjectFlow_Test`.

- **New WS collab spine — Hocuspocus Yjs server** (`apps/api/src/modules/collab/`). Runs **in-process** via the app's Node HTTP-server `upgrade` event at path `/collab` (attached after `serve()` in `server.ts`, non-test only); structured to run as a separable bootstrapped process in prod. `@hocuspocus/extension-redis` (reusing the existing ioredis via `new Redis({ redis: getRedis() })`) fans awareness/state across instances. Document name encodes `<kind>:<id>` — **`doc-page:<id>` for 7a, `whiteboard:<id>` reserved so 7b reuses the server unchanged.**
- **Hocuspocus v4 API divergences from the plan** (verified against installed `@hocuspocus/server@4.1.0` dist): `new Server(config)` (NO static `Server.configure`); the upgrade is fed to the server's `crossws` Node adapter `handleUpgrade(req, socket, head)` (no second port bound, never `.listen()`); `onStoreDocument` has **no `context`** (uses `lastContext`). The `handleUpgrade` call is `.catch()`-guarded (log + `socket.destroy()`) so a handshake-time rejection can't escalate to the global `unhandledRejection → process.exit(1)` (the prior SSE double-close crash class).
- **Auth fail-closed, ACL rides the scope node.** The ACL system only knows `SPACE|FOLDER|LIST` — there is **no `DOC` object type**. `onAuthenticate` verifies the JWT (`jsonwebtoken`, `JWT_SECRET`, claim `userId`), resolves page→doc→scope node (`usp_Doc_ResolveScopeNode`), and requires `accessService.can(userId, scopeType, scopeId, 'EDIT')`. EDIT is the connection floor (read-only VIEW connections are **not** supported in 7a — flagged for a follow-up). Authz split (per spec §3): **REST = workspace RBAC** (new `doc.create`/`doc.read`/`doc.update` slugs) with the workspace **derived from the scope** (see IDOR fix); **GraphQL + collab = object-level ACL** on the scope node (`requireObjectLevel`/`accessService.can`).
- **Persistence model.** `DocPages.BodyYjs VARBINARY(MAX)` (live CRDT) + a debounced (2s / 10s max) `BodyJson NVARCHAR(MAX)` ProseMirror-JSON snapshot for SSR first-paint + future search. Snapshot render uses `y-prosemirror`'s **`yXmlFragmentToProsemirrorJSON`** over the `'prosemirror'` fragment. **Restore** (`usp_DocPage_Restore`) checkpoints the current body, sets `BodyJson` to the chosen version, and **nulls `BodyYjs`** so the next connect re-seeds. To make restore actually appear in the live editor, `onLoadDocument` now **reconstructs the Yjs fragment from `BodyJson` when `BodyYjs` is absent** via `prosemirrorJSONToYXmlFragment` + a **hand-built minimal ProseMirror schema** (`docSnapshotSchema`) matching TipTap StarterKit's **camelCase** node names (`bulletList`/`listItem`/`codeBlock`/`hardBreak`/`horizontalRule` + the `embedTask` atom) — `prosemirror-schema-basic/-list` were rejected (snake_case names would fail `Node.fromJSON`). Reconstruction failure degrades to an empty doc (snapshot stays safe in `BodyJson`), never crashes the connection.
- **Hard editor contract:** the web TipTap editor MUST set `Collaboration.configure({ document, field: 'prosemirror' })` (default is `'default'`) so the client's Yjs fragment name matches the server's snapshot render + reseed; otherwise the persisted `BodyJson` would be empty.
- **Versioning / history.** `onStoreDocument` writes a `DocPageVersions` checkpoint on **each debounced store** (author = `lastContext.userId`, guarded — skipped if absent so the FK never breaks; wrapped so a checkpoint failure can't fail the persist). So history accumulates from normal editing. **Follow-ups:** version growth is currently unbounded (add pruning/throttling); the `DocHistoryPanel` fetches versions on mount only (no live-update during active editing) — the e2e reopens the doc to view history.
- **Page tree.** Nested `ParentPageId` + fractional `Position FLOAT`; the service computes positions via the pure `positionBetween` helper; `usp_DocPage_Move` has a recursive-CTE **cycle guard** (`THROW 51700` → REST 409). `usp_DocPage_Restore` `THROW 51701` → 404.
- **Security IDOR fix (caught in review).** Both `POST /docs` (REST) and `createDoc` (GraphQL) originally trusted a body/arg `workspaceId` as the RBAC/store value; now both **derive the workspace from `scopeId`** (SPACE→`ProjectRepository`, FOLDER→`FolderRepository`, LIST→`ListRepository` `getWorkspaceId`) and reject a mismatch — a member of one workspace can no longer create a doc scoped into another.
- **RBAC slugs** `doc.create`/`doc.read`/`doc.update` seeded idempotently in `0040_docs.sql` (owner/admin/member = all three, viewer = read); the rollback removes them. `requirePermission` is strictly slug-based (no owner wildcard), so seeding is required.
- **Dependencies (resolved).** API: `@hocuspocus/server`/`@hocuspocus/extension-redis` `4.1.0`, `yjs` `13.6.31`, `y-prosemirror` `1.3.x`, `prosemirror-model`, `ws`. Web: `@hocuspocus/provider` `4.1.0`, `@tiptap/{react,starter-kit,extension-collaboration}` **v2.27** + `extension-collaboration-cursor` **v2.26**, `yjs`/`y-prosemirror`. **TipTap pinned to v2** (the plan's unpinned install ERESOLVE'd react@3 against cursor@2; v3 also renamed `extension-collaboration-cursor`→`-caret`, diverging from the plan's `CollaborationCursor` API). `yjs` is a **single deduped instance** across the tree — no `overrides` needed.
- **Plan-SQL/seam deviations fixed during build:** `usp_DocPage_Move` — the plan's `;WITH … IF EXISTS(…)` is invalid T-SQL (a CTE can't precede a bare `IF`) → rewritten to capture membership into a `@IsDescendant BIT` flag (deploy-caught). `usp_Doc_SetWiki` — added the missing `AND DeletedAt IS NULL` to the trailing SELECT (review). `createTaskFromSelection` — `task.repository.create` returns the raw PascalCase `SELECT *` row, so `task.id` is undefined at runtime → read case-tolerantly (`(task as any).id ?? .Id`) (integration-caught SQL 515; same casing bug-class that bit prior slices). `createTask` real signature is `(input, actorId)` and `createTaskFromSelection` derives `projectId`/`workspaceId` from the **target list** (authoritative). Added `GET /docs/pages/:id` (the plan assumed it). i18n messages live at **`apps/next-web/messages/{en,id}.json`** (NOT `src/messages/`); `next/dist/docs/` is **absent** in this checkout (web conventions mirrored from `worklogs.ts`/`board/page.tsx`).
- **Deferrals (not in 7a acceptance):** inline doc comments — the Phase 4 comment store is **task-bound** (no generic object id), so doc-anchored comments need a new store → deferred (no second store invented). Slash commands ship as a data-only `SLASH_ITEMS` list (live `@tiptap/suggestion` wiring deferred). `embedTask` ships as a round-trippable atom node (live `TaskCard` node view deferred). `usp_DocPage_Update` ISNULL-coalesce can't clear Icon/Cover to NULL — convention-consistent with every other update SP app-wide; clearing isn't a 7a feature → accepted. Public doc sharing is Phase 10; full-text/vector search is Phase 11. **Stop for review/merge before Slice 7b** (7b reuses this collab server for `whiteboard:<id>`).

---

## 2026-06-11 — Phase 7b (Whiteboards: tldraw + Yjs over the shared collab server)

Phase 7b ships multiplayer, persistent whiteboards backed by [tldraw](https://tldraw.dev/) and Yjs, reusing the Hocuspocus collaboration server and auth layer introduced in 7a without modification. Branch `feat/phase7b-whiteboards`; verified live on Docker `ProjectFlow_Test`: **API 441 unit / 214 integration (50 files), web 113 unit (+ en/id parity), both builds clean, e2e `whiteboards` 2/2 live** (sticky→real task in the chosen list + two-browser co-edit), docs-collab e2e 3/3 (collab regression-clean). All DB work ran ONLY against local Docker `ProjectFlow_Test`.

### Schema and service (migration 0041)

`Whiteboards` stores `DocYjs VARBINARY(MAX)` (Yjs binary, source of truth) and `DocJson NVARCHAR(MAX)` (deferred — always NULL in 7b; `usp_Whiteboard_SaveDoc` `ISNULL`-coalesces so it never overwrites). `WhiteboardTaskLinks` is a join table with a `UNIQUE(WhiteboardId, TaskId, ShapeId)` constraint — `usp_WhiteboardTaskLink_Upsert` is idempotent. 10 new SPs; local Docker `ProjectFlow_Test` is now at migration **0041**, deployed SP count **297**.

**Whiteboards are scoped objects** (`ScopeType ∈ SPACE|FOLDER|LIST`, `ScopeId`) exactly like `SavedViews` — metadata + CRUD over REST (primary) with a GraphQL mirror, both routing through a single `WhiteboardService`. There is **no `WHITEBOARD` ACL node type** — authz rides the board's scope node. `requireObjectAccess`/`requireObjectLevel` only resolve `SPACE|FOLDER|LIST`; no new node kind was added. Workspace-RBAC slugs `whiteboard.create`/`whiteboard.read`/`whiteboard.update`/`whiteboard.delete` are seeded idempotently in `0041_whiteboards.sql` (owner/admin/member = all four, viewer = read only).

### Live canvas over the shared 7a Hocuspocus server

The whiteboard live canvas travels under doc name `whiteboard:<id>` — exactly the kind `docNameToTarget` already reserved in 7a, so **the server was not modified**. The load/store hooks for the `whiteboard` branch live **inline** in `apps/api/src/modules/collab/collab.server.ts`; there is no separate `collab.persistence.ts` (the plan assumed one — this deviation is intentional: the Hocuspocus extension API gives a single `onLoadDocument`/`onStoreDocument` pair, splitting by kind inside that pair keeps the load path and store path co-located and avoids a registration-order dependency).

`onAuthenticate` was extended to handle the `whiteboard:<id>` prefix: it calls `whiteboardService.getById(id)`, resolves the board's scope, and requires `accessService.can(userId, scopeType, scopeId, 'EDIT')` — fail-closed (unknown kind → reject). The doc-page path is unchanged.

`onLoadDocument` for a whiteboard branch seeds from `DocYjs` via `Y.applyUpdate(ydoc, row.DocYjs)`. There is **no JSON reseed** (tldraw is not ProseMirror; `prosemirrorJSONToYXmlFragment` is irrelevant here — DocYjs binary is the sole on-disk form).

`onStoreDocument` for a whiteboard persists `Y.encodeStateAsUpdate(ydoc)` to `DocYjs` via `usp_Whiteboard_SaveDoc`. It does **not** call `renderSnapshot()` (ProseMirror-only helper) and creates **no version checkpoint** (tldraw has no cheap server-side snapshot to render; versioning is deferred). 4 new collab-auth unit tests lock in the whiteboard scope-gate and the early-return boundary.

### DocJson is NULL — deliberately deferred

tldraw has no cheap server-side JSON serialization path analogous to `yXmlFragmentToProsemirrorJSON`. `usp_Whiteboard_SaveDoc` accepts `@DocJson NVARCHAR(MAX) = NULL` and `ISNULL`-coalesces so a NULL call never overwrites a previously set value. `DocYjs` (binary) is the authoritative source of truth; SSR first-paint of a whiteboard page is an empty canvas until Yjs syncs from the server. This is acceptable for v1. A future board-thumbnail or full-text search feature would require a client-pushed JSON snapshot on idle.

### convert-shape → task

The convert action calls `TaskService.createTask` (so notification fanout, webhooks, and progress rollup all fire as normal) then writes an idempotent `WhiteboardTaskLinks` row via `usp_WhiteboardTaskLink_Upsert`. The shape title is extracted by the **pure, unit-tested** `extractShapeTitle` helper (`packages/types/src/whiteboard/shape.ts`): reads `props.text` then `props.richText`, collapses internal whitespace, clamps to 500 characters, falls back to `'Untitled'`. The helper is shared verbatim between API and web (no serialization gap).

The helper was split into its own module (`shape.ts`) rather than inlined in the whiteboard service because the hook that calls it in the web layer transitively imports a server-only Next.js action — keeping the extractor in a pure `packages/types` file avoids a jsdom-incompatible import in the web unit-test suite.

### Cross-tenant hardenings (caught by final/opus review — single-tenant tests missed both)

**C1 — convert workspace derivation.** When converting a shape to a task, the task's workspace is derived **authoritatively from the target list** (`listRepo.getWorkspaceId(targetListId)`) and NOT from the whiteboard's own scope. A board in workspace A whose convert panel selects a list in workspace B would otherwise mint a task whose `WorkspaceId` mismatches the list's workspace — `usp_Task_Create` does not validate list-vs-workspace at the SP level. This mirrors the identical fix applied in `docs.service.createTaskFromSelection` (7a). The convert dual-gate: `task.create` permission on the **board's** workspace + `requireObjectAccess('EDIT')` on the **target list's** scope node; the GraphQL `convertShape` mutation additionally gates VIEW on the board scope (parity with REST) and throws `BAD_REQUEST` on invalid `shapeJson` (no phantom-task fallback on parse failure).

**I1 — create workspace reconciliation.** `POST /whiteboards` (REST) and `createWhiteboard` (GraphQL) both accept a caller-supplied `workspaceId`. Before saving, `WhiteboardService.getScopeWorkspaceId` resolves the scope's real workspace (SPACE → `ProjectRepository.getWorkspaceId`, FOLDER → `FolderRepository.getWorkspaceId`, LIST → `ListRepository.getWorkspaceId`) and rejects any mismatch with `WORKSPACE_MISMATCH` (→ HTTP 400). A member of one workspace cannot create a whiteboard scoped into another workspace's hierarchy. Negative-authz integration tests cover both holes: workspace mismatch on create → 400; convert with a cross-workspace target list lands the new task in the list's workspace, not the board's.

### The PascalCase casing landmine (reaffirmed)

`TaskService.createTask` returns the raw `usp_Task_Create` `SELECT *` row cast as `Task`. The **real** primary-key column is `.Id` (PascalCase), not `.id` (camelCase) — `.id` is `undefined` at runtime. The whiteboard→task link insert and the GraphQL `ConvertResult` resolver both read `(task as any).id ?? (task as any).Id`. **This is load-bearing, not dead code.** During 7b development an "obvious simplification" to `task.id` broke the convert with a NULL `TaskId` in the `WhiteboardTaskLinks` insert (caught by the integration test before merge). The case-tolerant read is commented in the source to prevent re-simplification.

### Frontend: tldraw 5.1.0 + manual Yjs store binding

**tldraw 5.1.0** declares `react ^18.2.0 || ^19.2.1` as a peer — compatible with the repo's React 19.2.4; clean install, no `transpilePackages` entry needed in `next.config`.

There is **no first-party tldraw↔Yjs binding** at v5; the binding is manual (`apps/next-web/src/lib/tldraw/yjsBinding.ts`):

- **Write path:** `store.listen({ source: 'user', scope: 'document' }, changes)` runs on every local user edit; added/updated records are written into a `Y.Map<TLRecord>` under an origin-tagged `ydoc.transact`; removed records are deleted from the map. Only `source: 'user'` events trigger this (pointer-only hover events are excluded).
- **Read path:** the `Y.Map` observer applies remote changes via `store.mergeRemoteChanges` and **skips its own origin** (the origin tag checked via `transaction.origin === ORIGIN`) — this prevents an echo loop where a local write triggers a remote event that triggers another local write.

The Hocuspocus provider reuses 7a's `getRealtimeToken` JWT fetcher and `NEXT_PUBLIC_COLLAB_URL` env var (default `ws://localhost:3001/collab`). No new env vars.

**React 19 Strict-Mode lifecycle fixes applied:**

- The Hocuspocus provider is not instantiated during render — it is created once in a `useRef` inside a `useEffect` to avoid the Strict-Mode double-mount orphan race.
- `initialDocJson` was removed from the Yjs bind-effect's dependency array; it only seeds an empty room on first connect and must not re-run when the prop reference changes (the binding is idempotent only on first call, not on re-invocation against an already-populated store).
- tldraw's `onMount` callback does not support a React cleanup return value (tldraw ignores the return). The selection listener that drives the convert panel is therefore torn down via a **dedicated unmount `useEffect`** whose cleanup calls `editor.off('change-selected-shapes')`, rather than relying on `onMount`'s non-functional cleanup slot.

### e2e: `window.__wbEditor` + `window.__wbTldraw` test handles

The `whiteboards.e2e.ts` spec drives the canvas programmatically via dev-only globals exposed on `window` (`NODE_ENV !== 'production'` guard): `window.__wbEditor` (the whiteboard service instance) and `window.__wbTldraw` (the tldraw `Editor`). This is more robust than attempting to simulate canvas pointer events or rely on tldraw's internal DOM structure, which changes between minor versions. **One e2e-driven UI fix:** the convert panel was repositioned to `top-center` with `z-index: 9999` because tldraw's native selection style panel (which renders top-right on any active selection) was intercepting pointer events on the convert button. Headline acceptance LIVE-VERIFIED: a sticky note shape is converted to a real task that appears in the chosen list; two browsers editing the same whiteboard converge without conflict.

### Deferrals (documented, not in acceptance)

- **Live multiplayer cursors/awareness** on the tldraw canvas (tldraw has a presence API; the Hocuspocus awareness channel is available but the cursor rendering extension was not wired up — deferred).
- **Full on-canvas custom embed shapes** for linked tasks — currently rendered as a simple `/tasks/{id}` link card atom; a rich `TaskCard` node view with live status is deferred (mirrors the 7a `embedTask` deferral pattern).
- **FOLDER/LIST-scoped convert list-pickers** — the convert panel passes the scope's child lists for SPACE-scoped boards; FOLDER/LIST boards currently pass `[]` (the target list input accepts free entry). Deferred until a proper scope-aware list picker component exists.
- **DocJson null** — no client-pushed snapshot; see above.
- **DocYjs/DocJson unbounded growth** — no pruning or compaction. Acceptable for v1; a background compaction job is a follow-up.

### DB-execution policy

All DB work (migration apply/rollback/re-apply, SP deploy, integration, e2e) ran ONLY against local Docker `ProjectFlow_Test` — never the prod-pointing `apps/api/.env`. Migration level: **0041**. SP count: **297**.

## 2026-06-11 — Phase 7c (Forms — intake subsystem)

A new `forms` module: a form **builder** (field types + conditional show/hide branching over prior answers + target-list + field→task mapping + optional Phase 5d template), a **public renderer** that evaluates branching client-side and posts a submission, and a backend that on submit validates against config+branching, creates a task in the form's `TargetListId` with the configured mapping (+ optional `templateService.apply`), and records a `FormSubmissions` row. **7c is independent of the 7a/7b CRDT stack** — no Yjs/Hocuspocus/tldraw.

### Data model (migration `0042_forms`)

- `Forms` (`Config` = `{fields[],branching[]}` JSON, `FieldMapping` = `{formFieldKey:{kind,target}}` JSON, `TargetListId`, `TemplateId` NULL, `IsPublic`/`PublicSlug`/`AuthRequired`, soft-delete) + `FormSubmissions` (`Answers` JSON, `CreatedTaskId` NULL, `SubmittedById` NULL = anonymous, `SubmittedAt`). JSON-in-`NVARCHAR(MAX)` mirrors `SavedViews.Config` / `Templates.Snapshot`.
- A **filtered unique index** `UQ_Forms_PublicSlug` (`WHERE PublicSlug IS NOT NULL AND DeletedAt IS NULL`) makes a live public slug globally unique without colliding on soft-deleted/non-public rows.
- SP-per-op (`usp_Form_Create/Update/GetById/GetBySlug/GetWorkspaceId/List/Delete`, `usp_FormSubmission_Create/ListByForm`). Migration reversible+idempotent; deployed SP count **306** (+9), DB now at **0042**.

### Unauthenticated surface

- The `/forms/public/:slug` **render** + `:slug/submit` pair is the **only unauthenticated API surface**. `server.ts` deliberately omits any blanket `app.use('/forms/*', authMiddleware)` (mirrors avatars/git-webhooks); protected CRUD attaches `authMiddleware` **inline** + an object-level ACL gate on the form's scope node (EDIT for write, VIEW for read), plus workspace-membership on create/list.
- The render returns a **stateless HMAC read token** = `HMAC-SHA256(JWT_SECRET, "form:"+id)` (NOT a secret — the form is public). Submit must echo a token minted for that slug. **Hardening (rate-limit / captcha / token-expiry beyond `AuthRequired`) is deferred to Phase 12.**
- **Optional-auth submit:** if a valid `Bearer` is present the submission attributes to that user (and `AuthRequired` forms accept it); an invalid/missing token falls through to anonymous (never 401s on its own). `AuthRequired && !actor` → 401. Required-on-**visible** validation + unknown-key rejection (422); `stripHiddenAnswers` drops branched-away values so a hidden answer never persists or maps onto the task. Anonymous submits set the task reporter to the **form creator** (a real `Users` row — `Tasks.ReporterId` is NOT NULL).

### Task creation — corrected vs the plan (load-bearing)

The plan's submit called `taskRepo.create({workspaceId,listId,…})`, but `Tasks` require a **`projectId`** (= the target list's `SpaceId`), which a Form does not store. The service therefore **resolves `projectId`+`workspaceId` from the target LIST** (authoritative) and creates via `TaskService.createTask`, mirroring `docs.service.createTaskFromSelection`. `createTask` returns the raw PascalCase `usp_Task_Create` row (no mapper), so the created id is read **casing-tolerantly** (`(task as any).Id ?? (task as any).id`) — the recurring casing-landmine class. Mapped custom-field values (`customFieldService.setValue`) and the optional template (`templateService.apply`) are best-effort (logged, never fault the submit); a `FormSubmissions` row is always recorded and `publishTaskEvent('created')` fires for live boards.

### Authz integrity — review fixes (cross-tenant)

- **Scope↔workspace reconciliation (final-review class):** the create SP validates the target list ∈ workspace but NOT the scope node. POST `/forms` and GraphQL `createForm` now call `FormService.getScopeWorkspaceId(scopeType, scopeId)` (mirrors `WhiteboardService`), reject `WORKSPACE_MISMATCH` (400), and **store the resolved workspaceId** so a member of workspace A with EDIT on a scope node in workspace B can't mount a cross-tenant form.
- `usp_Form_Update` adds a **target-list-in-workspace guard** (`THROW 51422`) so a form can't be re-pointed at another tenant's list (the plan's update SP lacked the create guard's check).
- REST maps SP validation throws `51420/51421/51422` → **422** and unique-slug collisions (`2601/2627`) → **409** (`FormSlugTakenError`), instead of leaking 500s.
- GraphQL **mirror covers metadata CRUD + submissions only**; public render/submit stay REST-only. Reads gate VIEW, writes gate EDIT.

### Frontend

- **Public route lives at `app/forms/public/[slug]/`** (URL `/forms/public/[slug]`), **not** the plan's `/forms/[slug]` — the latter collides with the authed builder `/forms/[id]` (Next.js forbids two different dynamic slug names at one path level). The chosen path also mirrors the API's `/forms/public/:slug`. It sits **outside `(app)`** (sessionless); the root-layout `IntlProvider` covers it, so `useTranslations` works.
- **Proxy auth-decision** (`src/proxy.ts` is Next 16's renamed middleware) allowlists `/forms/public/*`; the authed `/forms` list and `/forms/[id]` builder stay protected (they don't match the prefix). Without this the sessionless browser was 302'd to `/login` (caught by the e2e).
- The builder page builds its target-list picker by **flattening `getLists(spaceId)` across the workspace's projects** — there is no workspace-wide list loader, and `getLists` is space-scoped.
- i18n catalogs live at `apps/next-web/messages/{en,id}.json` (**not** `src/messages/`); a new `Forms` namespace (en + real Indonesian), `messages.unit` parity green. The renderer evaluates branching client-side via a shared `lib/formBranching.ts` whose logic is identical to the server's `form.branching.ts`, so client hide/show matches server validation.

### Test-fixture change

`truncateAll` gained `FormSubmissions` + `Forms` in child-first FK order (`FormSubmissions` FK Tasks/Forms/Users; `Forms` FK Lists/Workspaces/Users) — without it `beforeEach` cleanup failed `FK_FormSubmissions_Task` once a submission existed (caught when running the forms integration suite).

### Deferrals (documented, not in acceptance)

- **Form hardening** — submission analytics, captcha, rate-limiting, and read-token expiry beyond `AuthRequired` are the Phase 12 follow-up.

### DB-execution policy

All DB work (migration apply/rollback/re-apply, SP deploy, integration, e2e) ran ONLY against local Docker `ProjectFlow_Test` — never the prod-pointing `apps/api/.env`. Migration level: **0042**. SP count: **306**. Verified: API **452 unit / 217 integration**, web **117 unit** (+ en/id parity), API+web builds clean, forms **e2e 1/1** (§6.5).

## 2026-06-11 — Phase 8a — Time Tracking

Turned the existing `WorkLogs` CRUD module into a real time-tracking system: a start/stop running timer (one active per user), billable flag, entry tags, manual/range/timer sources, per-task time estimates with estimate-vs-actual, subtask→parent rollup, and a GraphQL mirror over the one shared `WorkLogService`. Migration **0043**; DB now at **0043**, deployed SP count **312** (+6 new SPs).

### Schema — evolve WorkLogs in place (no TimeEntries table)

- A running timer **IS** an open `WorkLogs` row (`EndedAt IS NULL`, `Source='timer'`). `0043` adds `EndedAt DATETIME2 NULL`, `Billable BIT NOT NULL DEFAULT 0`, `Source NVARCHAR(10) NOT NULL DEFAULT 'manual'` ('manual'|'range'|'timer'). "One active timer per user" is enforced by a **filtered unique index** `UQ_WorkLog_ActiveTimer ON WorkLogs(UserId) WHERE EndedAt IS NULL` plus an auto-stop guard inside `usp_WorkLog_StartTimer` (closes any open row before inserting the new one). New tables: `WorkLogTags(WorkLogId,TagId)` and `TaskEstimates(TaskId,UserId,EstimateSeconds,…)`; `Tasks` gains `TimeEstimateSeconds INT NULL`. Migration idempotent (catalog guards) + reversible (apply→rollback→re-apply verified clean).

### "Tags" are dbo.Labels — the plan's `dbo.Tags` does NOT exist (real bug, caught at deploy)

The plan FK'd `WorkLogTags.TagId` to `dbo.Tags(Id)` and `usp_WorkLogTag_Set` joined `dbo.Tags`, but **this codebase has no `dbo.Tags` table** — user-facing "tags" are stored in **`dbo.Labels(Id, ProjectId, Name, Color, CreatedAt)`** (migration 0011), linked to tasks via `dbo.TaskLabelLinks`. The migration FK + the SP's existence-check + result JOIN were corrected to `dbo.Labels`. The `WorkLogTags`/`TagId`/`tagIds` API vocabulary was kept (matches the REST/TS surface). The dual `ON DELETE CASCADE` (→WorkLogs and →Labels) is safe only because `Tasks.ProjectId` is `NO ACTION`, so there is no multiple-cascade-path to `WorkLogTags` — documented inline in `0043`; do not change `Tasks.ProjectId` to CASCADE without revisiting.

### Manual/range entries derive EndedAt (real bug, caught by integration)

The plan note said "manual/range entries always set EndedAt" but `usp_WorkLog_Create` defaulted `@EndedAt = NULL`, so a manual entry fell under `UQ_WorkLog_ActiveTimer` and a user's **second manual log collided** on the unique index (the integration test surfaced the 2627 duplicate-key). Fix: `usp_WorkLog_Create` now sets `EndedAt = DATEADD(SECOND, @TimeSpentSeconds, @StartedAt)` when `@EndedAt IS NULL AND @Source <> 'timer'`. Only `Source='timer'` rows (created via `usp_WorkLog_StartTimer`) stay open.

### SPs + rollup

- SP-per-op: `usp_WorkLog_StartTimer` (auto-stop + insert open `timer` row), `_StopTimer` (`EndedAt` + `DATEDIFF`), `_GetActiveTimer`, `usp_WorkLogTag_Set` (replace tag set from a **comma-delimited `@TagIds` GUID list** via `STRING_SPLIT` + `TRY_CONVERT` + `EXISTS dbo.Labels` — no TVP, mirrors the flat-string transport used elsewhere; non-existent ids are silently dropped, a deliberate cross-tenant guard), `usp_Task_SetEstimate` (`@UserId` NULL → `Tasks.TimeEstimateSeconds`; else MERGE a per-assignee `TaskEstimates` row), `usp_Task_GetTimeRollup`. Create/Update/ListByTask extended for billable/source/endedAt.
- `usp_Task_GetTimeRollup` walks a recursive CTE **down `ParentTaskId`** (filtering `DeletedAt IS NULL`, `OPTION (MAXRECURSION 0)`) and returns own-only (`OwnLoggedSeconds`/`OwnEstimateSeconds`) + subtree (`RollupLoggedSeconds`/`RollupEstimateSeconds`). The FROM-less outer SELECT always returns exactly one row (zeros/NULL for a missing task) — `OwnEstimateSeconds` is intentionally nullable (no `ISNULL`), the other three coalesce to 0. Pure `estimateVsActual()` (`rollup.ts`) derives `ratio` (null when no estimate), `remainingSeconds` (clamped ≥0, null when no estimate), `overBudget`.

### GraphQL mirror

`worklog.schema.ts` (`registerWorkLogGraphql()`, registered after `registerTagsGraphql()`) mirrors `recurrence.schema.ts`: `WorkLog`/`TaskTimeRollup` types; `taskWorkLogs`/`activeTimer`/`taskTimeRollup` queries (read paths gate **object-level VIEW** on the task's List); `startTimer`/`stopTimer`/`create/update/deleteWorkLog` mutations (write paths gate `worklog.create` **workspace permission**; update/delete are owner-scoped by the SP's `WHERE UserId=@UserId`). REST stays primary; both delegate to the one `WorkLogService`. `source` uses `t.string(resolve)` (not `exposeString`) since `WorkLogSource` is a union.

### Web data layer

- The REST timer/rollup routes return **raw bodies** `{ log }` / `{ rollup }` (NOT the `{ data }` envelope), so the server actions use `serverFetchBody` (not `serverFetch`, which unwraps `.data`). Loaders (`getActiveTimer`, `getRollup`) return the value directly (or null); mutations (`startTimer`, `stopTimer`, `setEstimate`) return `ActionResult<T>` whose `.data` carries the log/rollup. `addWorkLog`/`editWorkLog` inputs gained optional `billable`/`source`/`tagIds`/`endedAt`.
- `GlobalTimerWidget` (mounted in the layout-1 header) loads the active timer, ticks a 1s live elapsed counter, and renders **null when idle**. `WorkLogSection` gained a billable toggle, manual/range mode, a Space-tag multi-select (via the existing `loadSpaceTags(spaceId)` action — `spaceId` now threaded from `TaskDrawer`), a "Start timer" button, plus per-entry `data-worklog-source`, billable/running badges, and tag chips. `TaskEstimateBar` (mounted above `WorkLogSection`) shows the estimate field + estimate-vs-actual bar + subtree rollup total; `duration.ts` holds the shared `formatDuration`/`parseDuration`.
- **Cross-component sync via a `window` CustomEvent `'worklog:timer-changed'`:** `WorkLogSection`'s "Start timer" and the widget's "Stop" both dispatch it; the widget and `WorkLogSection` both listen and refetch. This is what makes a timer started in the task panel light up the header widget, and a timer stopped in the header surface the closed entry back in the panel list.

### e2e

`e2e/time-tracking.spec.ts` (repo-root `e2e/`, modeled on `dependencies.spec.ts`) drives the full headline flow live: open a task drawer → Log work → Start timer → assert the header widget appears ticking → Stop → assert it hides and a `[data-worklog-source="timer"]` entry surfaces → set an estimate → assert the `[data-estimate-bar]` legend. The header widget sits visually **behind** the open `TaskDrawer` (the drawer header intercepts pointer events at the widget's coords), so even a forced coordinate click lands on the drawer — the Stop click uses `locator.dispatchEvent('click')` to invoke the React handler directly. **Follow-up (polish, not acceptance):** raise the global timer widget's z-index / portal it above the drawer so it's pointer-reachable while a drawer is open.

### Final-review fixes (cross-tenant — caught by the whole-slice opus review, missed by the all-permissions green suite)

1. **REST read IDOR** — `GET /worklogs/tasks/:taskId/rollup` (new) and `GET /worklogs?taskId=` (pre-existing, mirrored) had NO object gate while the GraphQL twins gate object VIEW, so any authenticated user could read any task's time totals/per-user breakdown by GUID. Both now run `requireObjectAccess('VIEW', resolveTaskList)` (resolves the task's List → VIEW, fail-closed 404/403), matching the GraphQL mirror. (Inserting the middleware reset Hono's path-param inference → `c.req.param('taskId')` non-null-asserted.)
2. **Cross-tenant tag attach** — `usp_WorkLogTag_Set` admitted any `Label` that merely existed, not one in the task's Space, so a caller could attach (and read the name/color of) another tenant's `Label` by guessing its id. The SP now scopes `EXISTS dbo.Labels` to `tg.ProjectId = <task's ProjectId>` (mirrors `usp_Tag_LinkTask`).
3. **`source:'timer'` reachable 500** — the manual create paths accepted `source='timer'`, which `usp_WorkLog_Create` left open (`EndedAt NULL`) → `UQ_WorkLog_ActiveTimer` duplicate-key 500. `usp_WorkLog_Create` now derives `EndedAt` whenever absent **regardless of source** (Create only ever makes completed entries; StartTimer is the sole open-row path), and `'timer'` was dropped from the REST `createSchema` enum. Two negative-authz integration tests added (intruder rollup/list → 403/404; foreign-Space label dropped). The minor "PATCH can't clear billable=false / empty description" was accepted as the module's existing ISNULL-coalesce no-clear semantics.

### DB-execution policy

All DB work (migration apply/rollback/re-apply, SP deploy, integration, e2e dev servers) ran ONLY against local Docker `ProjectFlow_Test` — the e2e dev servers were booted by Playwright with a shell-exported local DB env that overrides the prod-pointing `apps/api/.env` (Node `--env-file` precedence). Migration level **0043**, SP count **312**. Verified: API **458 unit / 223 integration** (52 files, incl. 2 cross-tenant neg tests), web **120 unit** (+ en/id parity), API+web builds clean, time-tracking **e2e 1/1**.

## 2026-06-12 — Phase 8b — Timesheets

A submit/approve **envelope** over the 8a `WorkLogs`. The new `Timesheets` table carries only `Status` (`draft|submitted|approved|rejected`) + review metadata; the line data stays in `WorkLogs`, aggregated within `[PeriodStart, PeriodEnd]` by `usp_Timesheet_Aggregate`. One envelope per `(UserId, PeriodStart, PeriodEnd)`. Migrations **0044** (the table) + **0045_timesheet_perms** (seeds the `timesheet.read/submit/approve` permission slugs into `Permissions`+`RolePermissions` — without it fail-closed RBAC would 403 even the workspace owner; the plan omitted this, the implementer caught it); DB now at **0045**, deployed SP count **319** (+7 new SPs; 0045 is permission DML, no new SP). A new `timesheets` API module (SP-per-op repo → shared `timesheetService` → Hono REST primary + Pothos GraphQL mirror) follows the `worklogs`/`sprints` shape. Stop-for-review before 8c.

### Schema — envelope only, line data stays in WorkLogs

- `0044` adds `Timesheets(Id, WorkspaceId, UserId, PeriodStart DATE, PeriodEnd DATE, Status, SubmittedAt, ReviewedById, ReviewedAt, Note, CreatedAt, UpdatedAt)` with `CK_Timesheets_Status`, `UQ_Timesheet_Period (UserId, PeriodStart, PeriodEnd)`, and a `IX_Timesheet_Workspace (WorkspaceId, Status)` cover. Idempotent (catalog guards, GO-batched) + reversible (forward→down→forward proven on `ProjectFlow_Test`).

### SPs (7) + aggregation

- `usp_Timesheet_GetOrCreate` (insert-if-missing then select), `_GetById`, `_List`, `_Aggregate`, `_Submit`, `_Review`, and `usp_WorkLog_PeriodLocked`.
- **`usp_Timesheet_Aggregate`** groups `WorkLogs` by `(CAST(StartedAt AS DATE), TaskId)` within the period, splitting `Billable` vs non-billable seconds; **`EndedAt IS NOT NULL` excludes running timers**. Returns two result sets: per-day×task rows + a period grand-totals row (mapped to `{ rows, totals }`).
- Status-transition guards throw distinct SQL error numbers: **51810** (illegal submit source), **51811** (illegal review source), **51812** (not found), **51813** (bad decision), **51820** (aggregate of a missing timesheet). Submit/Review use `UPDLOCK, ROWLOCK` + TRY/CATCH/TRANSACTION; submit is `draft|rejected → submitted` (re-submit allowed), review is `submitted → approved|rejected`.

### Period lock (touches the 8a write path)

`usp_WorkLog_PeriodLocked(@UserId, @WorkDate)` returns `IsLocked BIT` = 1 when a `submitted`/`approved` timesheet covers that user's work date. `WorkLogService.create`/`update` call `repo.isPeriodLocked` before writing and throw `PeriodLockedError`; `worklog.routes` maps it to **HTTP 422** on POST and PATCH. Reopening (reviewer setting the sheet back to `rejected`/`draft`) lifts the lock because only `submitted`/`approved` rows count. The worklog suite is otherwise unchanged (unlocked writes still succeed).

### REST primary + GraphQL mirror, one service

- REST: `GET /timesheets` (with `periodStart`+`periodEnd` → get-or-create that envelope; without → list the user's), `GET /timesheets/:id`, `GET /timesheets/:id/aggregate`, `POST /timesheets/:id/submit`, `POST /timesheets/:id/review`. SP error-number → HTTP: 51810/51811/51813 → **409**, 51812 → **404**.
- GraphQL: `timesheet`/`timesheetAggregate` queries + `submitTimesheet`/`reviewTimesheet` mutations; illegal transitions throw `ILLEGAL_TRANSITION`.
- Authorization is fail-closed: **`timesheet.read`** (reads), **`timesheet.submit`** (submit), **`timesheet.approve`** (review) — REST `requirePermission`, GraphQL `requireWorkspacePermission`; mutating GraphQL resolvers resolve the envelope's `workspaceId` via `getById` first.

### Frontend

- `timesheet-grid.tsx` — TanStack Table (day×task rows, period totals + billable split in `tfoot`, seconds→"Xh Ym") with a submit button disabled for `submitted`/`approved`. `timesheet-review.tsx` — approve/reject with status badges, buttons enabled only while `submitted`. New `Timesheets.*` i18n namespace in `en.json` + `id.json` (real Indonesian); `messages.unit` parity green.

### e2e — two latent bugs caught running the authored spec live

`e2e/timesheets.spec.ts` (REST-driven: log a closed 1h billable entry → get-or-create envelope → aggregate → submit → approve → confirm a later worklog in the approved period 422s). The spec was authored in the prior session but **never run**; the first live run surfaced two real bugs in its own seeding: (1) it read the token from the **register** response's non-existent `.accessToken` (the API returns the token from a separate **login** at `data.token`); (2) workspace create posted only `{ name }` but the route requires `name` **and** `slug`, so the seed cascade 400'd and surfaced late as a 400 on the worklog write. Both fixed + per-step id assertions added so a seed failure pins to its own call. No production code changed — these were test-seeding bugs.

### Final whole-slice review fixes (opus, before merge)

The final review found **no Critical/cross-tenant holes** (the RBAC chain is genuinely fail-closed — `usp_UserPermissions_Get` only returns a workspace's slugs to a member; mutating routes resolve the workspace from the timesheet's own row). Two **Important** items were fixed:

1. **Period-lock PATCH bypass — locked time was mutable via a move-out.** `WorkLogService.update` only checked the *destination* date: when `patch.startedAt` was present it skipped reading the existing row, so a worklog inside a submitted/approved period could be PATCHed to an unlocked `startedAt` (with a new duration), silently editing it out of the locked period. Fix: always read the existing row and reject if **either** the entry's current (origin) date **or** the new destination date is locked — locked time is now immutable (editing requires reopening). (`worklog.service.ts`)
2. **No negative-authz integration coverage.** All prior timesheet tests ran as the all-permission owner, leaving the codebase's most-regressed bug class (an authz hole the green suite misses) unguarded. Added a test proving a non-member gets **403** on get-or-create / read / aggregate / submit / review, plus a test proving the move-out PATCH now returns **422**.

Accepted residuals (documented, not blocking): `UQ_Timesheet_Period`/`GetOrCreate` are keyed `(UserId, PeriodStart, PeriodEnd)` without `WorkspaceId` (plan-faithful — a user in two workspaces gets the first one's envelope back for the same period; not a leak, the second call still requires membership); `usp_Timesheet_Aggregate` counts worklogs on soft-deleted tasks (deliberate — don't lose logged/billable hours when a task is deleted); the two web components (`timesheet-grid`/`timesheet-review`) are built + unit-tested but **not yet wired to a page route** (the plan's File Structure specified no page.tsx — surfacing `/timesheets` is a follow-up).

### DB-execution policy

All DB work (migration apply/idempotency/rollback, SP deploy, integration, e2e dev servers) ran ONLY against local Docker `ProjectFlow_Test` — never the prod-pointing `apps/api/.env`. Migration level **0045**, SP count **319** (+7 SPs; 0045 is permission DML). Verified: API **471 unit / 228 integration** (incl. `timesheet.routes`: get-or-create/aggregate/submit→approve, illegal-review 409, locked-period 422, **non-member 403**, **move-out 422**), web **125 unit** (+ en/id parity), API+web builds clean (FULL TURBO), timesheets **e2e 1/1**.

## 2026-06-12 — Phase 8b follow-up — `/timesheets` page route

Closes the one documented 8b deferral: the `timesheet-grid` / `timesheet-review` components existed + were unit-tested but were not wired to a page. **Web-only — no API, schema, SP, or migration change** (DB stays at **0045** / SP **319**).

### Surface — the caller's own weekly timesheet
The page is **My timesheet**: a Monday→Sunday week for the signed-in user. `?period=YYYY-MM-DD` (any day in the week) is normalized to the week's Mon→Sun bounds; default is the current week. Prev/next week are plain `<Link>` GET navigations that re-run the server page (no client refetch). The single active workspace auto-scopes via `resolveActiveId` (same as `/board`); no-workspace renders a localized empty state.

### Reviewer panel is permission-gated, not role-played
`TimesheetReview` (approve/reject) renders only when the caller holds `timesheet.approve`, checked server-side via `/auth/me/permissions?workspaceId=` (auth-only, never 403 — workspace-member gets read+submit, owner/admin additionally approve). The grid's Submit is the owner action; both are also disabled by status in the components themselves.

### Pure period math, TDD-first
`apps/next-web/src/lib/timesheet-period.ts` (`weekPeriodOf`/`currentWeekPeriod`/`shiftWeekPeriod`) does all week boundary math in **UTC on date-only values** so it is TZ/DST-independent (a `Date` arg contributes only its local Y/M/D, re-anchored at UTC midnight). 9 unit tests written before the impl. Display dates render via noon-anchored ISO (`…T12:00:00`) through the fixed-en-US formatter to avoid day shift (matches `lib/date.ts`).

### Data layer mirrors existing patterns
New `server/queries/timesheets.ts` (get-or-create + aggregate + `canApproveTimesheets`) and `server/actions/timesheets.ts` (`submitTimesheet`/`reviewTimesheet`, `revalidatePath('/timesheets')`) — same `serverFetch` + `ActionResult` + `requireSession` idioms as `forms`/`worklogs`. Client view calls the actions in a `useTransition` and `router.refresh()` on success; errors surface via `notifyActionError`.

### Accepted residual + follow-up
This page cannot be a **team reviewer queue**: the API's timesheet `list` is caller-scoped (`list(workspaceId, userId)`), so there is no "all submitted timesheets in the workspace" feed. An approver therefore reviews their *own* submitted sheet here. A proper review queue needs a new list-all-in-workspace endpoint (+ authz) — deferred, noted as the next timesheets follow-up. Nav link added under **Workspace** (`Clock` icon, `Nav.timesheets`).

### Verification (web-only)
Web **138 unit** (+9 period, +4 view; was 125) incl. en/id i18n parity, `tsc --noEmit` clean, `next build` clean (`/timesheets` dynamic route present), **timesheets-page e2e 1/1** on local Docker `ProjectFlow_Test` (seed → view aggregate `1h 0m` → submit→Submitted → approve→Approved → cleanup 204). No DB writes beyond the e2e's own seeded+deleted workspace.

## 2026-06-12 — Phase 8d (Workload & Box Views)

Adds two Views-Engine view types: **`workload`** (per-assignee capacity bars flagging over/at/under capacity) and **`box`** (assignee-swimlane board). One shared `viewService.capacity()` built on the existing Phase-3 query **compiler**, surfaced as a GraphQL `viewCapacity` query **and** a parallel REST `GET /views/capacity` mirror; pure unit-tested helpers do the classification/fold. Built subagent-driven (per-task TDD implementer + spec + code-quality review, final whole-slice opus review).

### Architecture — capacity computed live, no new task SQL
Capacity is summed **live** from existing columns — `Tasks.TimeEstimateSeconds` (8a) + `Tasks.StoryPoints` — per assignee over the SAME compiled WHERE the view's task page uses, so it inherits the Views Engine's tenant/scope/filter isolation (`ViewRepository.capacityByAssignee` reuses `compiled.whereSql` + `compiled.params`, joins `TaskAssignees`→`Users`). Two pure helpers do the logic: `classifyCapacity(assigned, capacity)` → `over|at|under` + ratio (2% tolerance band, `Infinity` for zero-capacity), and `aggregateCapacity(rawRows, opts)` folds PascalCase SQL rows → classified camelCase `CapacityResult`, sorted by descending ratio. The only persisted config is **config-only `SavedViews.config` keys** (`capacityMetric`, `capacityPerDaySeconds`, `capacityPerSprintPoints`) — no new SP.

### Fail-closed authz, dual surface
Both surfaces authorize BEFORE any work and mirror `previewViewTasks`: node scopes (LIST/FOLDER/SPACE) require object-level `VIEW`; EVERYTHING requires `workspace.read`. The node-scope workspace is derived SOLELY from the authorized scope node (`getScopeNode(scopeId)`) — a caller-supplied `workspaceId` is never consulted for node scopes, so it cannot widen the aggregation cross-tenant. `config` (caller JSON) can only *narrow within* the authorized scope (filter AND-appended after the mandatory tenant+scope predicates), never widen it. Final opus review traced both surfaces end-to-end: **zero cross-tenant holes**.

### Deviation from plan — migration 0048 WAS required (caught by the live e2e)
The plan's DoD asserted "**No DB migration**", but `SavedViews` carries `CK_SavedViews_Type CHECK (Type IN ('list','board','table','calendar'))` from migration 0032 — so `createSavedView('workload'|'box')` failed at the DB CHECK. Every unit/integration test missed it because they exercised `viewService.capacity` directly, never inserting a `workload`/`box` row through the constrained table; the **Playwright e2e (the only path that creates a real saved view)** caught it. Added **migration `0048_savedviews_workload_box_types.sql`** (idempotent drop+recreate of the CHECK to include the two types) + matching `rollback/0048_*.down.sql`. Local DB now **0048**; **SP count unchanged at 325**.

### Review-caught fixes (per-task)
1. **DueDate is DATETIME2 (0024), not DATE.** The range bound was binding `sql.Date`, truncating `@to` to midnight and silently dropping same-day-afternoon tasks. Fixed to `sql.DateTime2` with a half-open upper bound (`DueDate < DATEADD(DAY,1,@to)`) — whole `to` day inclusive, index-sargable. Regression-guarded by an integration case with a `15:30` due time.
2. **Capacity-range vs day-count coherence.** `ViewService.capacity` normalizes the range to **date-only once** at the service boundary and feeds that to BOTH the SQL range and `daySpanInclusive`, so the days counted == the calendar days the SQL includes (no skew from date-vs-datetime input).
3. **REST authorizes before parsing config** (was parse-then-authz) — removes a tiny shape oracle, matching the GraphQL order.
4. **Infinity-ratio JSON safety on both surfaces** (REST `sanitizeRow`→1e9; GraphQL `t.float` clamp→1e9).
5. **Negative-authz integration coverage** added (non-member→403 node, missing scope→404, unauth→401) — the codebase's most-regressed bug class.

### Accepted residuals / follow-ups (final opus review — all Minor, none blocking)
1. **`days=0` (no range) fallback** multiplies per-day capacity by 1 while the SQL sums ALL assigned tasks → a workload view opened with no `?from/&to` can show misleading "over" flags. The fold's behavior is a documented, unit-pinned contract; per the approved plan the range is **URL-param driven** (`?from=&to=`) with **no default range and no range-picker UI this slice**. Follow-up: default the page to a sensible window (e.g. current week) or render a neutral "capacity unknown" state when no range is given.
2. **No create-view UI for the new types** — they arrive via API/config/seeding (same as `board` pre-engine). Follow-up: add `workload`/`box` to the view-create affordance.
3. **Box view has no live sub** (`view-surface` passes only `taskPage`+`activeView`; no `useLiveTasks`) — v1 groups client-side from the SSR page; updates need an SSR re-seed. Follow-up: wire `useLiveTasks` like the other engine surfaces.
4. **meMode + co-assignee fan-out (cosmetic):** a me-mode workload view can surface co-assignees of the caller's shared tasks. Acceptable for v1.

### DB-execution policy
All DB work (migration 0048 apply + rollback file, integration, e2e dev servers) ran ONLY against local Docker `ProjectFlow_Test` — never the prod-pointing `apps/api/.env` (shell-exported `DB_*` override `--env-file-if-exists`; prod cutover of 0048 deferred to ops). Local DB **0048**, SP **325** (unchanged — 8d adds no SP). Verified: API **493 unit / 252 integration**, web **146 unit** (incl. en/id parity), API+web builds clean, **workload-box e2e 2/2** (Workload flags an over-capacity assignee; Box groups tasks into per-assignee swimlanes). Final whole-slice opus review: **READY TO MERGE — zero Critical/Important, cross-tenant + PascalCase/camelCase seam + full wire-up all verified clean.**

## 2026-06-13 — Phase 8e (Goals & Targets)

Greenfield Goals module: goal folders → goals → number/boolean/currency/task **targets**, with an equal-weighted progress rollup computed **on read** (no stored progress column). A `task`-kind target's completed/total is recomputed **event-driven** from `TaskService.transitionTask` (the same fire-and-forget after-commit seam Phase 5c recurrence uses), so closing a task advances any goal that counts it. Built subagent-driven (controller wrote/ran all SQL+DB; per-batch implementer + spec/quality reviewers, opus on the SQL/service/authz batches + a final whole-slice opus review).

### Deviations from the plan
1. **Migration renumber 0046→0049.** The plan (written 2026-06-07) named the migration `0046_goals`, but 0046/0046b/0047/0048 were consumed by Sprints (8c) + Workload/Box (8d) afterward. Renumbered to **`0049_goals.sql`** (next free) + rollback. (Reconciliation Explore agent run FIRST, as every prior slice — confirmed all other plan seams MATCH current code.)
2. **A permission-seed migration WAS added (`0050_goal_perms.sql`).** The plan's Task 8 only said "find the seed and append goal.* slugs", but the repo convention (0045 timesheet_perms, 0047 sprint_manage_perm) is a dedicated seed migration — and without it the fail-closed RBAC 403s even the owner (the exact 8b/8c trap). Seeds `goal.create`/`goal.update`/`goal.delete` (WORKSPACE scope) with grants: owner+admin+member get create+update; owner+admin get delete (mirrors docs.* authoring + sprint.delete management tier); **workspace-viewer gets none** (reads are gated on ANY-OF the goal.* slugs since there is no `goal.read` slug — so viewers can't read goals; consistent REST↔GraphQL; broadening to viewers is a documented follow-up). Local DB now **0050**; SP files **342** (+15 CRUD/recompute + 2 authz resolvers).
3. **`TaskFilter` is a `{taskIds:[...]}` id-list**, not a full query-compiler filter (per the plan). The low-frequency reconcile sweep is intentionally **not built** — the after-commit hook is the sole rollup path.

### Architecture
Pure progress math (`goal-progress.ts`, API + an **identical** client mirror, both unit-tested per-kind + average + empty/clamp/degenerate cases — diffed identical by the final review): number/currency = `(cur-start)/(target-start)` clamped; boolean = `cur>=1?1:0`; task = `done/total` clamped; goal = equal-weighted avg, empty→0. SP-per-op repo → one `goalService` → Hono REST (primary) + Pothos GraphQL mirror. `recomputeForTask(taskId)` lists the task-kind targets whose `TaskFilter.taskIds` includes the task and recomputes each (`done = ResolvedAt IS NOT NULL` over the `DeletedAt`-filtered id list — mirrors `usp_TaskCustomField_RecomputeProgressAuto`). Hook is `void`-dispatched after `repo.transition` commits, double error-guarded (the dispatch AND `recomputeForTask` swallow), outside any txn, no loop risk (it only UPDATEs Targets, never transitions tasks). Migrations idempotent + reversible (apply→rollback→re-apply proven on local Docker).

### Review-caught fixes (the payoff — none caught by the green owner-only suite)
- **Batch-1 (opus DB review):** the repo has a **universal enum-CHECK convention** and 8d proved a missing CHECK escapes unit+integration and only surfaces in live e2e → added idempotent `CK_Goals_Status`/`CK_Goals_ScopeType`/`CK_Targets_Kind` + an `@ScopeType` THROW 52803 guard in `usp_Goal_Create` (previously inserted ScopeType unchecked).
- **Batch-3 (opus TS review):** `dueDate` mapper used `String(r.DueDate)` → a TZ-shifted locale string, violating the types' "ISO date" contract → `new Date(r.DueDate).toISOString().split('T')[0]` (the repo-wide DATE idiom). Also: `updateGoal` was made `async` to **preserve folderId when the caller omits it** (`usp_Goal_Update` always-assigns FolderId so a partial/status-only PATCH — and GraphQL `updateGoal`, which never sends folderId — would have silently un-foldered the goal).
- **Batch-4 (opus SECURITY review — 3 cross-tenant holes the owner-only suite missed):** **(C1)** all 4 REST GETs were ungated (GraphQL gated reads) → cross-tenant read of goals/folders/targets (incl. currency values + taskFilter) → gate each on ANY-OF `goal.*`, resolving workspace from the query param (lists) or the resource id (by-id). **(C2)** `DELETE /goals/folders/:id` trusted a caller-supplied `?workspaceId` while `usp_GoalFolder_Delete` removes by Id only → cross-tenant folder removal → new `usp_GoalFolder_GetWorkspaceId` + `resolveFolderWorkspace` authorize the FOLDER's real workspace. **(I3)** target PATCH/DELETE gated on the URL `goalId` but the SP acts on `targetId` (no GoalId predicate) → mismatched-parent cross-tenant target write → new `usp_Target_GetWorkspaceId` + `resolveTargetWorkspace`. All three locked by a negative-authz integration test (attacker with their OWN workspace → 403 on every surface; victim data untouched).
- **Batch-6 (frontend review):** the SSR `/goals` page hardcoded `progress:0, targets:[]` (list endpoint only, no per-goal fetch) → the e2e's 100% assertion would have always seen 0% → page now fans out `Promise.all(getGoalWithProgress(id))`. Plus `goal.progress ?? …` (0 ??-bug) → `typeof === 'number'` guard, and two i18n gaps (Expand/Collapse aria + task-id placeholder) closed. (The review's "CRITICAL-2 folderId" flag was a STALE cross-reference — the Batch-3 service preserve-fix was already in place; verified, no change.)

### Accepted residuals / follow-ups (final opus review — all Minor, none blocking; READY TO MERGE, zero Critical/Important)
1. **Folder-orphan render gap (web):** a goal whose `FolderId` points at a soft-deleted folder renders in no section. Fix: bucket goals whose folderId ∉ live-folder set into "No folder".
2. **No same-workspace validation on `Goal.scopeId`/`folderId` (REST create) or `task`-target `taskFilter` ids.** NOT a leak (reads filter by the goal's own workspace; rollup only ever writes the caller's own Target, exposes no foreign data) — an integrity gap. Follow-up: validate scope/folder/task ids belong to the goal's workspace.
3. **SSR per-goal fan-out** (one `GET /goals/:id` per goal) — fine at typical counts, unbounded in a huge workspace; a `listGoalsWithProgress` batch endpoint would remove it.
4. **`updateTarget` can't clear a value to NULL** (COALESCE = leave-unchanged; `0` works) — matches the repo-wide partial-update convention.
5. **No GraphQL updateTarget/deleteTarget/folder mutations** — deliberate surface gap (REST is the primary, fully-covered surface), not a hole.

### DB-execution policy
All DB work (0049+0050 apply + rollback proof, SP deploy, integration, e2e dev servers) ran ONLY against local Docker `ProjectFlow_Test` — never the prod-pointing `apps/api/.env` (shell-exported `DB_*` override `--env-file-if-exists`; cold-booted e2e servers inherit the local env; prod cutover of 0049/0050 deferred to ops). Local DB **0050**, **342 SP files**. Verified: API **503 unit / 256 integration** (incl. goals 4/4 + cross-tenant negative authz), web **156 unit** (incl. en/id parity), API+web builds clean, **goals e2e 1/1** (task-linked target → 100% via REST poll + UI render). 18 commits on `feat/phase8e-goals-targets` off 8d tip `27b848b`.

---

## 2026-06-13 — Phase 9a (Dashboards core)

The hardcoded dashboard becomes a first-class, scoped, config-driven object: `Dashboards` + `DashboardCards` tables (scope/visibility mirroring `SavedViews`), a movable/resizable dnd-kit card grid, wave-1 card types (`task_list`/`calculation`/`bar`/`line`/`pie`/`time_tracked`/`goal`) resolved through one shared `card.service` dispatcher, per-card filters, and `?print=1` browser print-to-PDF. REST primary + GraphQL mirror over one service. Built subagent-driven (per-batch implementers + spec/quality review; **final opus whole-slice review = READY TO MERGE, zero cross-tenant holes**). Branch `feat/phase9a-dashboards-core` off `main` tip `f4e53df`; 13 commits.

### The decisive mechanism — one resolver, three data sources (`card.service`)
A `CardType`-keyed `CardResolver` registry (`card.service.ts`) with a public `register()` seam (9b adds card types; 9c snapshots by iterating `resolve()`):
- **generic cards** (`task_list`/`calculation`/`bar`/`line`/`pie`) → the Phase 3 view compiler via `viewService.runConfig(scopeType, scopeId, cardConfigToViewConfig(config), opts, dashboard.workspaceId, userId)`. A card is "a saved query + a chart shape", run under the **dashboard's own** workspace+scope; the route/GraphQL layer asserts object-level VIEW on the scope first, so a card never returns rows the requester couldn't read directly.
- **`time_tracked`** → a new scope-aggregating SP `usp_Dashboard_TimeTracked` (SUM `WorkLogs.TimeSpentSeconds` over `Tasks` filtered by `@WorkspaceId` + `ListPath LIKE @ScopePrefix`, grouped by user). The prefix is derived from the dashboard's own resolved scope, never attacker-controlled.
- **`goal`** → the **real** Phase-8 `goalService.getGoalWithProgress` with a cross-tenant guard (`goal.workspaceId !== dashboard.workspaceId` → empty/pending). **DEVIATION from the plan**, which shipped `goal` as a stub "until Phase 8 lands" — Phase 8e has landed, so the real service is wired (the stub was unnecessary).

### Deviations from the plan (it predated Phases 6/7/8)
- **Migration renumber `0047` → `0051_dashboards`** (0038–0050 taken by Phases 6/7/8) + **NEW `0052_dashboard_perms`** seeding `dashboard.read/create/update/delete` (read→all incl. viewer; create/update→owner/admin/member; delete→owner/admin). Without the slugs, `requirePermission`/`requireWorkspacePermission` fail-close 403 even the owner (the recurring 8b/8c/8e trap). Local DB now **0052**, **354 SP files** (+12 dashboard/card SPs).
- **`WorkLogs.TimeSpentSeconds` exists** (original 0010, kept by 8a) — the reconciliation pass flagged it as a "CRITICAL drift" (claimed it moved to Tasks); verified directly against the migration that it does NOT — the plan's TimeTracked SP is correct. (Lesson: verify schema claims against the migration, not an agent summary.)
- **`card.service` uses a synchronous `makeSeriesResolver(type)` factory** registered in the constructor, NOT the plan's trailing top-level-await registration (cleaner; sidesteps the plan's async-return-type bug even though tsconfig supports TLA).
- **Web: `serverFetch<T>` already unwraps the `{data}` envelope and does NOT auto-stringify the body** (`api.ts`) — the plan's literal `.then(r => r.data)` + raw-object bodies were wrong; actions/queries mirror the real `worklogs.ts`/`reports.ts`.
- **`GET /dashboards` (list-by-scope) was ungated in the plan** (a cross-tenant read hole, same class as 8e C1) → now `requirePermission('dashboard.read')` + object-level VIEW on the scope node. The final review also added the same VIEW gate to **`GET /dashboards/:id`** for REST↔GraphQL parity (metadata/card-config, not task rows, otherwise leaked to a workspace member lacking node VIEW).

### Real bugs caught (the green owner-suite missed them; the process caught them)
1. **`reorderCards` 500 (integration-caught):** the repo double-stringified `layout`, so the SP's `OPENJSON '$.layout' AS JSON` got a JSON *string* → NULL → `Layout NOT NULL` violation. Fix: pass `layout` as a nested object.
2. **`'use server'` async-function requirement (next build-caught):** the plan's `export const x = () => …` arrow-const actions are rejected by Next ("Server Actions must be async functions") — but only once the module enters the client-import graph (Task 9 built green while unimported, then Task 11 broke). Fix: `export async function` declarations.
3. **`revalidatePath` during render:** seeding the default dashboard by calling the `createDashboard` action from the page (server component) would throw (revalidatePath during render). Fix: `ensureWorkspaceDashboards` seeds via a direct `serverFetch` POST (no revalidate).
4. **`truncate.ts` FK-547 landmine (the 8c lesson):** `Dashboards` FKs `Workspaces`+`Users`; leftover rows block the whole integration suite's `beforeEach`. Added `DashboardCards`→`Dashboards` child→parent before `Workspaces`/`Users`.
5. **Integration task-in-list seeding:** the implementer's `createTestTask` set no `listId` → the SPACE-scope view returned 0 rows. Fixed to create the task in the list (the plan's original idiom).

### Tests
- Unit: `card-aggregate` (config→ViewConfig mapping, count/sum/avg/min/max, empty/non-numeric) + `visibility` (canReadDashboard, one-default-per-scope preview) + web `card-registry` (every wave-1 type → renderer + fallback).
- Integration (`dashboards.integration.test.ts`, 4/4): CRUD + live `task_list`/`calculation` card data, **object-level scoping** (non-member stranger → 403/404, never rows), reorder persistence + one-default-per-scope.
- e2e (`e2e/dashboards.spec.ts`, 1/1): build a dashboard, add 6 card types with live data, apply a per-card filter, Export PDF → `?print=1` layout. (`window.print` stubbed; addInitScript persists across the App-Router client nav.)

### Verified (local Docker `ProjectFlow_Test`)
API **512 unit / 260 integration** (60 files, +4 dashboards, 0 regressions), web **158 unit** (incl. en/id parity), API+web builds clean, **dashboards e2e 1/1**. Migrations 0051/0052 reversible + idempotent (apply→down→re-apply→re-apply clean). DB **0052**, **354 SP files**.

### Follow-ups (none blocking; logged for 9b)
1. **`resolveCalculation` sum/avg/min/max cap at 200 rows** (`viewService` MAX_PAGE_SIZE) — `count` (DB total) and bar/line/pie (SQL groupCounts) are exact; field-aggregates over >200 tasks are computed over the first 200. Not reachable in 9a (no field picker UI); **9b must move sum/avg/min/max into SQL before adding a field picker.**
2. **`fieldAccessor` builtin-casing** — only `story_points→StoryPoints` is mapped; other builtin numeric fields would read a PascalCase row with a camelCase key → NaN → dropped. Latent until 9b's field picker.
3. **`DashboardView` ignores its `dashboards` prop** — no dashboard-switcher UI in 9a; the page shows the workspace default or `?id=`.
4. **Print layout renders inside the app-shell chrome** — the `?print=1` page is under `(app)/layout`; a chrome-free print route / `@media print` CSS is a polish follow-up.
5. **Two hardcoded empty-state strings** in `card-registry.tsx` ("No time logged", "Unsupported card type") + the print-card raw `card.type` title — minor i18n gaps.

### DB-execution policy
All DB work (0051+0052 apply + rollback proof, SP deploy, integration, e2e dev servers) ran ONLY against local Docker `ProjectFlow_Test` — never the prod-pointing `apps/api/.env` (shell-exported `DB_*` override `--env-file-if-exists`; cold-booted e2e servers inherit the local env; prod cutover of 0051/0052 deferred to ops). **Stop for review/merge before Slice 9b.**

## 2026-06-13 — Phase 9b (Analytics & Sprint/Portfolio Cards)

Lifts reporting from REST-only to a full GraphQL mirror, adds 4 advanced analytics report SPs, and extends the 9a `card.service` dispatcher + renderer registry with the analytics/entity card catalog. Acceptance (§5.5): **sprint burndown + velocity compute correctly against real sprint data** — verified by `reports.integration.test.ts` (velocity committed=14/completed=12; GraphQL burndown == REST) and the `dashboard-analytics` e2e (burndown/velocity/portfolio cards render real seeded data). Built subagent-driven (reconciliation Explore FIRST, then per-batch implementer/review; opus on the GraphQL-mirror + card.service-guard batches) against local Docker `ProjectFlow_Test`.

### Report SPs (4 new, no schema change for the reports themselves)
- `usp_Report_Burnup` — complement of `usp_Report_Burndown`: cumulative COMPLETED vs flat committed SCOPE per day (2 resultsets: meta + per-day). Reads `Sprints`/`Tasks` columns the existing reports use.
- `usp_Report_CumulativeFlow` — per-day status-band counts over a hierarchy scope. **v1 band**: a task resolved on/before a day → `DONE`, else its current `Status`. True per-status history from `AuditLog` is a documented follow-up (§11.6); the long-form `(Date,Status,IssueCount)` shape is stable either way.
- `usp_Report_LeadCycleTime` — per-task lead (created→resolved) + cycle (first in-progress→resolved). The "started" timestamp is the earliest `dbo.AuditLog` `UPDATE` row whose `NewValues` JSON mentions an in-progress token; falls back to no-cycle when none. (`AuditLog.ResourceId` is NVARCHAR → `TRY_CONVERT(UNIQUEIDENTIFIER, …) = Tasks.Id`.)
- `usp_Report_Portfolio` — rollup across a SET of folders/lists via comma-delimited `@ScopeIds` (`STRING_SPLIT`+`TRY_CONVERT`, same transport as `usp_WorkLogTag_Set`). `progressPct` + `onTrack` are derived in the pure `analytics.ts` helper (v1 on-track heuristic: completed ≥ 50% of issues, or empty scope = on-track).

### DEVIATION — a migration WAS required (the plan said "no migration")
The plan gates the new GraphQL mirror on `report.read`, but that slug was **never seeded** (the reports module was REST-only and **completely ungated** — any authenticated user could read any workspace's reports, a pre-existing cross-tenant read / IDOR). Without seeding, `requireWorkspacePermission`/`requirePermission` fail closed and even a workspace owner gets 403 (the exact trap that bit 8b/8c/8e/9a). So: added **`0053_report_perms`** (idempotent, mirrors `0052`) seeding `report.read` for owner/admin/member/viewer (read is broad), and **gated ALL 9 reports REST routes (5 existing + 4 new) + the GraphQL mirror on `report.read`**, closing the IDOR. Local DB now **0053**, SP count **358** (+4). REST workspace resolution: sprint→`sprintService.getSprintWorkspaceId`, project→`projectService.getById().WorkspaceId` (raw SP row is **PascalCase**), scope→`CustomFieldRepository.getScopeNode(scopeType.toUpperCase(), id).workspaceId`; the portfolio resolver requires the whole scope-id set to resolve to ONE workspace (cross-workspace set → fail-closed 404).

### GraphQL reports mirror (first GraphQL surface for reports)
`graphql/reports.schema.ts registerReportsGraphql()` mirrors all NINE queries (`burndown`/`velocity`/`sprintSummary`/`workload`/`createdVsResolved` + `burnup`/`cumulativeFlow`/`leadCycleTime`/`portfolio`) over the ONE shared `ReportsService`, each `report.read`-gated on the resolved workspace; portfolio asserts a single workspace across the scope set (fail-closed). Used the REAL seams (the plan guessed `sprintService.getById`/`HierarchyRepository.getNode`, neither exists). Added named `WorkloadEntry`/`CreatedVsResolvedEntry` types for the object refs — but these **already existed** ~L475 of `packages/types` (the reconciliation Explore agent missed them; TS declaration-merging hid the dup from tsc) → removed the duplicate. **Lesson reaffirmed: verify types by grep, not an agent summary.**

### card.service — 9 branches + a per-card CROSS-TENANT GUARD the plan omitted
The 9a dispatcher is a `Map<CardType, CardResolver>` with `resolve(card, dashboard, userId)`. 9b registers 9 resolvers reading params from the existing `card.config.reportParams` slot. **The plan added NO authz to the card path** — but report-card params (`sprintId`/`scopeId`/`scopeIds`/`taskId`) are attacker-controllable by anyone who can EDIT the dashboard, so a card could surface another workspace's report. Mirrored 9a's `resolveGoal` guard: each report resolver resolves the param's OWNING workspace and returns a pending (`data:null`) payload unless it equals `dashboard.workspaceId` (sprint via `getSprintWorkspaceId`, project via `projectService.getById().WorkspaceId`, scope via `getScopeNode`, task via `TaskRepository.getWorkspaceId`); portfolio requires every scope in the set to match. `battery` runs the 9a generic compiler path under the dashboard's OWN scope (no external id → inherently tenant-safe). Proven by a dispatch test (8 routing + 1 cross-tenant guard).

### Enabling changes (otherwise 9b cards were uncreatable)
The 9a `cardCreateSchema` zod enum (REST `POST /dashboards/:id/cards`) and the `DashboardGrid` `ADDABLE` toolbar list were wave-1-only, so the 9b card types could not be created (API 400) nor added from the UI. Both extended with the 9 new tokens. (The GraphQL `createDashboardCard` takes `type` as a permissive string — no enum there.) Renderers null-guard the pending payload via an `EmptyCard` ("No data") since the cross-tenant guard returns `data:null`. `CardData.shape` gained `'report'`; the registry passes the whole `CardData` and extracts `.data`.

### Verification (local Docker `ProjectFlow_Test`)
API **528 unit / 264 integration** (66+61 files; +16 unit = 7 analytics + 9 card.analytics; +4 reports integration), web **158 unit** + en/id parity, `apps/api` tsc + `apps/next-web` next build clean, **dashboard-analytics e2e 1/1** (burndown/velocity/portfolio render real seeded data). Migration 0053 idempotent.

### Follow-ups (none blocking)
1. Cumulative-flow true per-status history from `AuditLog` (v1 derives the band from `ResolvedAt`/current `Status`).
2. Lead/cycle "started" relies on `AuditLog` `NewValues` LIKE-matching in-progress tokens — brittle if status names diverge; a typed status-transition audit would be cleaner.
3. Config editors are minimal text/select inputs writing `reportParams` (no live sprint/scope pickers); a picker UI is a polish follow-up.
4. Portfolio over a `space` scope-type returns empty (SP supports folder/list only, per plan); the type narrows to folder/list.
5. Battery card's sum/avg aggregates inherit the 9a 200-row page cap (count is exact) — move to SQL before relying on field-aggregates over large scopes.
6. Two hardcoded empty-state strings (`EmptyCard` "No data", FallbackCard) — minor i18n gaps.

### DB-execution policy
All DB work (0053 apply, SP deploy, integration, e2e dev servers) ran ONLY against local Docker `ProjectFlow_Test` — never the prod-pointing `apps/api/.env` (shell-exported `DB_*` override `--env-file-if-exists`). Prod cutover of 0053 deferred to ops. **Stop for review/merge before Slice 9c.**

### Final whole-slice review (opus, 2026-06-13) — READY TO MERGE
No Critical / no cross-tenant findings: all 9 REST routes + 9 GraphQL queries gate `report.read` resolving the workspace server-side; portfolio scope-sets spanning workspaces fail closed on all 3 surfaces; the PascalCase `WorkspaceId` read is correct at every project-resolution site (a lowercase read would have fail-closed every card); all 9 card.service branches guard `param-workspace === dashboard.workspaceId` (battery is scope-internal). Two **Important** follow-ups tracked (cycle-time sub-metric only — NOT the burndown/velocity acceptance, and a known-approximate v1 per spec §11.6):
- **Cycle-time is always NULL in the GraphQL/UI path** — `usp_Report_LeadCycleTime` sources the first in-progress timestamp from `dbo.AuditLog`, but status transitions via the **GraphQL `transitionTask` mutation write no AuditLog row** (`auditMiddleware` is mounted REST-only). Lead-time (created→resolved) is unaffected. Real fix: emit a status-change audit row from `taskService.transitionTask`, then assert a non-null `cycleTimeSeconds` in the integration test.
- **Two of the three in-progress LIKE patterns are dead** — the audit `NewValues` snapshot is PascalCase (`"Status":"In Progress"`) and `Tasks.Status` holds the free-text workflow status NAME, so `'%IN_PROGRESS%'` and `'%"status":"IN PROGRESS"%'` never match (only `'%In Progress%'` fires, for the default name). Match the workflow status whose Category = `IN_PROGRESS` instead of literal-name LIKEs.
- Minor: `battery` honors `config.aggregate` but `CardConfigDrawer` only shows the aggregate selector for `calculation`/`bar` (add `'battery'` to `showAgg`); `usp_Report_Burnup` could guard a NULL sprint StartDate.

## 2026-06-14 — Phase 9c (Scheduled Reports)

Make a dashboard deliverable on a recurring cadence. A `ScheduledReports` row binds a dashboard + an RRULE-ish cadence (the Phase 5 recurrence rule shape) + a recipient set + a channel; a BullMQ 5-min repeatable sweep (`scheduled-report.worker.ts`, a structural twin of `recurrence.worker.ts`) snapshots the dashboard, records an idempotent run, and delivers an in-app notification. Built subagent-driven (reconciliation Explore FIRST → per-batch implementers → controller wrote/ran ALL SQL+DB → final opus whole-slice review). DB only on local Docker `ProjectFlow_Test`.

### Mechanism
- **Idempotency keystone:** `ScheduledReportRuns UNIQUE(ScheduledReportId, PeriodKey)` where `PeriodKey = occurrence.toISOString()`. `usp_ScheduledReportRun_Record` does `IF NOT EXISTS … WITH (UPDLOCK, HOLDLOCK)` in a txn + folds 2627/2601 into `Inserted=0` returning the existing row → a worker restart re-attempting the same period is a no-op INSERT, delivery fires only on `inserted=true` → never double-delivers. (Smoke-verified directly + integration worker-restart test.)
- **Sweep:** pure `runScheduledReportSweep(now?)` drives `listDue` → `runDue` (snapshot → record → deliver-if-inserted → advance) so unit/integration/e2e drive it without Redis/BullMQ. `startScheduledReportWorker()` is Redis-gated + `started`-guarded, registered in `server.ts` beside `startRecurrenceWorker()`.
- **Cadence:** reuses Phase 5 `validateRule`/`computeNextOccurrence` (no `count` semantics — runs until disabled or `endsAt`). Advance sets `NextRunAt=null` → `Enabled=0` at cadence end.
- **Snapshot freeze:** resolves every card via the real 9a `cardService.resolve(card, dashboard, ownerId)` (dashboard fetched with cards via `dashboardService.getWithCards`), JSON deep-clones each payload → a later live-source change can't mutate the frozen snapshot (unit-asserted). Stored as `SnapshotRef` JSON on the run.
- **Delivery:** `DeliveryChannel` adapter map — `inbox` → `notificationService.notify({type:'SCHEDULED_REPORT_READY'})`; `email` is an explicit no-op stub (deferred to Phase 12). The frontend notification renderer (`notification-meta.ts TYPE_META`) gained a `SCHEDULED_REPORT_READY` entry (+ `labelScheduledReport`/`summaryScheduledReport` Inbox i18n en/id).
- REST primary + Pothos GraphQL mirror over the ONE `ScheduledReportService`; both gate `scheduled_report.manage`.

### Deviations vs the plan (it predated 9a/9b/8x)
- **Migration renumber:** plan said `0048`; 0048–0053 were taken → `0054_scheduled_reports` (tables) + **NEW `0055_scheduled_report_perms`** seeding `scheduled_report.manage` (owner+admin+member; viewer excluded — a single manage slug gates BOTH read and write, so viewers see no schedule editor). Without the seed, fail-closed RBAC 403s even the owner (the 8b/8c/8e/9a/9b trap). Local DB now **0055**, **367 SP files** (+9). Migrations reversible+idempotent (apply→rollback→re-apply verified clean).
- **Card resolver signature:** plan assumed `resolve(card, scope)`; real 9a is `resolve(card, dashboard, userId)` → snapshot binds to `getWithCards` + resolves under the OWNER's id.
- **`DashboardId` is a plain column (no FK):** a schedule survives a dashboard delete (run history stays readable) + dodges cascade/truncate-order coupling. Tenant safety comes from the explicit gates below, not an FK.
- **i18n at `apps/next-web/messages/`** (not src/messages); server actions use `serverFetch` (unwraps `{data}`) + `ActionResult`; recipient options sourced from the existing `loadWorkspaceMembers` action.
- Dev-only `POST /api/v1/dev/scheduled-reports/sweep` (404 in prod, mirrors `automation.dev.routes.ts`) for deterministic e2e.

### Final whole-slice review (opus) — 2 must-fixes found + FIXED (the documented payoff)
The owner-only green suite structurally could not catch these; both are now closed + regression-tested:
- **C1 (CRITICAL, cross-tenant exfiltration):** `create` did not bind `dashboardId` to `input.workspaceId`, and the snapshot path called `cardService.resolve` **without** the object-level VIEW gate that the dashboard card-data route applies (`viewService.runConfig` trusts the caller — no membership re-check). A `scheduled_report.manage` holder in workspace A could schedule workspace B's dashboard (or a space they can't see) and the owner-scoped snapshot would resolve + deliver it to themselves. **Fix:** `assertDashboardSnapshotAccess(dash, scheduleWorkspaceId, userId)` — rejects when `dash.workspaceId !== schedule.workspaceId` (binding) AND requires workspace membership (workspace-scope) or `accessService.can(VIEW)` (node-scope), mirroring the card-data route exactly. Enforced at `create` (→ 403) AND fail-closed in `snapshotWith` via an injected `assertAccess` dep (a pre-existing mis-bound row records a 'failed' run, never a leaked snapshot).
- **I1 (IMPORTANT):** recipients were format-validated only; the full frozen snapshot JSON is fanned into each recipient's notification payload, so an author could push owner-resolved data to arbitrary/foreign uuids (and the manage-gated snapshot-viewer route was bypassed via the payload). **Fix:** recipients must be members of the schedule's workspace (validated at create/update → 400) + a current-member filter at delivery fan-out (defense for later-removed members). The snapshot stays IN the payload deliberately — it's the delivery channel for member-recipients who lack `manage` and are therefore 403'd from the viewer route; payload size is a documented follow-up.
- Service errors mapped to HTTP/GraphQL: `ScheduleAccessError`→403/FORBIDDEN, `RecipientNotMemberError`→400, `InvalidCadenceError`→400 (REST `mapScheduleError` + GraphQL `rethrowAsGraphql`).

### Accepted residuals / follow-ups (none blocking)
- Snapshot viewer route searches only the most-recent 50 runs (`listRuns(id,1,50)` + find) → a valid link to an older run 404s once history grows; add a `usp_ScheduledReportRun_GetById` lookup (M1).
- Full snapshot JSON embedded in every recipient notification payload (bloat) — acceptable for v1 since it's how non-manage recipients view the report; revisit with a recipient-scoped viewer route (I1 tail).
- `runDue` advances past a transient snapshot failure (records 'failed', logs the failed-record write if THAT also fails — no bare swallow now); a period lost to a transient blip is not retried (matches the recurrence-worker precedent).
- Dashboard run-history panel shows only the FIRST schedule matching the dashboard; snapshot page renders frozen `card.data` as JSON (not per-type renderers) — intentional read-only v1.

### Verification (local Docker `ProjectFlow_Test`)
API **535 unit / 271 integration** (incl. idempotency worker-restart + C1 403 + I1 400 + fail-closed snapshot); web **158 unit** + en/id parity; apps/api tsc + Next build clean; **scheduled-reports e2e 1/1** (REST schedule → dev sweep → one delivered run + frozen snapshot → recipient SCHEDULED_REPORT_READY notification → read-only snapshot viewer + dialog). Migrations reversible+idempotent; SP idempotency smoke-verified.

### DB-execution policy
All DB work (0054/0055 apply+rollback+re-apply, SP deploy, integration, e2e dev servers) ran ONLY against local Docker `ProjectFlow_Test` — never the prod-pointing `apps/api/.env`. Prod cutover of 0054/0055 deferred to ops. **Stop for review/merge before Slice 9d.**

## 2026-06-15 — Phase 9d (Gantt + Timeline Views)

Adds the **Gantt** and **Timeline** view types end-to-end, plus the cross-cutting **view-type union expansion** that 9e/9f depend on. A Gantt view shows dependency lines (Phase-5 `TaskDependencies`), a highlighted critical path (longest dependency chain by duration), and a captured baseline overlay; a drag (v1 double-click "+1 day") updates dates and reflects live in List/Board. Timeline is a lighter facet-grouped date-lane view over the same task page.

### Migration renumber (plan 0049 → **0056**)
The plan assumed an on-disk tip of `0048`; the actual tip was `0055` (9c added 0054/0055), so the migration was renumbered to **`0056_view_types_and_baselines.sql`** (+ embedded comment kept in sync). Local Docker `ProjectFlow_Test` now at **0056**; SP count **370** (+3: `usp_Baseline_Capture`, `usp_Baseline_List`, `usp_View_GanttDeps`).

### CK_SavedViews_Type → full 14-type union (and the rollback correction)
`0056` drops + recreates `CK_SavedViews_Type` from the **six-type** state (Phase 8d's `0048` had already extended it to include `workload`/`box`) to the full union `list, board, table, calendar, workload, box, gantt, timeline, activity, map, mindmap, embed, chat, doc`. The same union is kept **byte-identical** in three places: the DB CHECK, the `ViewType` union (`packages/types`), and the GraphQL `VIEW_TYPES`/`assertViewType` allow-list (`views.schema.ts`). **The plan's rollback was wrong** — it restored the *four-type* CHECK, which would orphan any existing `workload`/`box` rows; the actual `rollback/0056` restores the **six-type** pre-0056 state. Migration verified idempotent + reversible (apply → down → re-apply, all clean). Side effect: the pre-existing `views-graphql` integration test that used `type:'gantt'` as its "invalid type" probe was updated to `'nonsense'` (gantt is now valid).

### Baselines (frozen date snapshots)
`Baselines(Id, ViewId→SavedViews ON DELETE CASCADE, Name, CapturedAt, CreatedBy)` + `BaselineTasks(BaselineId, TaskId, StartDate DATE, DueDate DATETIME2)` (dates mirror `Tasks.StartDate`/`DueDate` from 0024). `usp_Baseline_Capture` freezes the in-scope tasks' current dates inside one txn (comma-delimited `@TaskIds` GUID transport + `STRING_SPLIT`/`TRY_CONVERT`, mirroring `usp_WorkLogTag_Set`); `usp_Baseline_List` returns two recordsets (headers newest-first + frozen rows) which the repo zips by `BaselineId` (keys lowercased to future-proof the join against GUID casing skew). `usp_View_GanttDeps` returns `TaskDependencies` edges where BOTH endpoints are in the supplied id set.

### Single Gantt task source = the Phase-3 compiler
`GanttService.resolve` reuses `ViewService.runConfig` (the same compiled task query the other views use → inherits tenant/scope/filter isolation) at `pageSize: 200`, joins the scope's dependency edges, computes the critical path (pure, memoized longest-path DFS over the acyclic DAG; on a duration tie it prefers the chain with more nodes so a zero-duration successor still extends the path — a unit test caught the original strict-`>` tie-break dropping `['A','B']` to `['A']`), and reads the view's baselines. **Casing reaffirmed:** `runConfig` returns RAW PascalCase `SELECT t.*` rows (the camelCase `mapTaskRow` normalization lives only in the GraphQL layer), so `resolve` reads `r.Id`/`r.StartDate`/`r.Assignees[].UserId` (PascalCase) by design. GraphQL `viewGanttData(viewId)` query + `captureBaseline(viewId,name)` mutation, both fail-closed via the same `requireObjectLevel(VIEW)` / `requireEverythingWorkspace` gates as the sibling view resolvers. `captureBaseline` is gated at VIEW (read) level deliberately — a baseline is a read-derived snapshot of dates the caller can already see; no task data is mutated.

### startDate threaded through the shared Task type (plan omitted)
The shared GraphQL `Task` (`TaskShape`/`TaskType`) + `mapTaskRow` + the SSR `VIEW_TASKS_QUERY`/`PREVIEW_VIEW_TASKS_QUERY` previously carried `dueDate` but **not `startDate`** — yet the Gantt/Timeline bars read `tk.startDate` from the SSR `taskPage`. Added `startDate` (casing-tolerant `x.startDate ?? x.StartDate`, Date scalar) across all of them (`normalize-task` already read it). Also threaded `startDate` into the **live** delta path (`TASK_EVENTS` subscription + `TaskDelta` + `mergeTaskDelta`) so a cross-tab drag's start-date change merges live too.

### Reschedule realtime publish (the date PATCH path now emits)
`roadmap.service.updateDates` previously returned the updated row but published nothing, so a Gantt/Timeline drag would not reflect live. It now `void publishTaskEvent('updated', { projectId, taskId, task: row })` (fire-and-forget — doesn't block the drag's HTTP response; the helper guards its own errors). The **full PascalCase `usp_Task_UpdateDates` row** is published as `task` (not just `taskId`) so List/Board/Calendar re-merge the new dates live; the shared `TaskType` resolves both casings, so the PascalCase row serializes fine. Reuses the existing `updateTaskDates` roadmap server action for the drag; only `captureBaseline` is a new action.

### Renderers + v1 move affordance
`gantt-view.tsx` (bars, SVG dependency elbows via pure `gantt-geom.lanePath`, critical-path highlight, baseline overlay + capture button) and `timeline-view.tsx` (facet-grouped date lanes) both consume the SSR task page through `useLiveTasks` exactly like `calendar-view.tsx`; registered in `view-surface.tsx`'s `ViewBody` switch; SSR-loaded in the views page (`loadGanttData`, mirroring the board/workload conditional fetches). The move affordance is a v1 **double-click "+1 day"** (a pointer-drag handler can refine the UX later without changing the data contract). i18n `Gantt`/`Timeline` namespaces (en + real-Indonesian id), parity green.

### e2e lessons (reusable)
- A dependency line between **adjacent** tasks (A.due == B.start) renders a degenerate **zero-width vertical** SVG path → Playwright reports it `hidden`. Seed non-adjacent dates (A 06-01→06-03, B 06-05→06-10) so the elbow has horizontal extent.
- The absolutely-positioned bars sit under their row wrapper in Playwright's hit-test (`<div data-testid="…-row"> intercepts pointer events`) → drive the drag via `locator.dispatchEvent('dblclick')` (bypasses actionability; React's root listener still fires `onDoubleClick`). Same interception class as the 8a header-timer-behind-drawer note.

### Verification (local Docker `ProjectFlow_Test`)
API **541 unit** (+6 gantt) / **274 integration** (+3 gantt; fixed the 1 invalid-type regression), web **162 unit** (+4 gantt-geom) + en/id parity, `apps/api` tsc + `apps/next-web` next build both clean, **gantt-timeline e2e 2/2** (deps + critical path + baseline + live-drag-in-List; timeline lanes + reschedule). Migration reversible + idempotent.

### Residuals / follow-ups (non-blocking)
1. `GanttService.resolve` caps the canvas at 200 tasks with no overflow signal (`ViewGanttData` has no `total`) — the plan's acknowledged bound; add a `total` if a "+N more" affordance is wanted.
2. `captureBaseline` returns `tasks: []` in the mutation response by design (the gantt-view `router.refresh()`-re-fetches `viewGanttData` for the populated baseline) — documented, not a bug for this UI.
3. v1 move = double-click "+1 day"; a real pointer-drag handler is deferred (data contract unchanged).
4. `baselineDiff` is unit-tested + exported but not yet wired to a UI overlay (available for a planned-vs-actual drift badge).

### DB-execution policy
All DB work (0056 apply+rollback+re-apply, SP deploy, integration, e2e dev servers) ran ONLY against local Docker `ProjectFlow_Test` — never the prod-pointing `apps/api/.env`. Prod cutover of 0056 deferred to ops. **Stop for review/merge before Slice 9e.**

## 2026-06-15 — Phase 9e (Activity / Embed / Doc Views)

Adds the three "lens" view types to the Views Engine: **activity** (a hierarchy-scoped, object-level-filtered, paginated reverse-chronological feed over the existing `dbo.AuditLog`, with **live prepend** off the shared realtime stream), **embed** (a sandboxed `<iframe>` over an allow-listed external URL stored in `SavedViews.config`), and **doc** (a feature-flagged stub for the Phase 7 reader). Each new type is a client renderer registered in `view-surface.tsx`; only Activity adds a backend resolver. **NO migration** — the `ViewType` union + `CK_SavedViews_Type` CHECK were already expanded by 9d (verified against the live DB: the CHECK admits all 14 types), Activity reuses the existing `usp_AuditLog_List`, and Embed/Doc carry their target in `config`. Local DB stays at **0056 / 370 SPs** (no new SP).

### Activity feed = scoped + post-filtered audit read, no new source of truth
`activity.service.getActivity(userId, scopeType, scopeId, workspaceId, filters)` resolves the scope's workspace (EVERYTHING uses the supplied `workspaceId`; node scopes via `CustomFieldRepository.getScopeNode` → camelCase `{workspaceId}`), reads a page through `usp_AuditLog_List` (unchanged), then applies a per-entry **object-level visibility post-filter** (`accessService.can(userId, nodeType, resourceId, 'VIEW')`) so the feed never surfaces an event for a hierarchy object the user couldn't open. Pure helpers extracted + unit-tested: `clampPage` (default 50 / cap 200, matching the SP default) and `buildAuditFilters` (with an `nz` empty-string→"no filter" normalizer so a blank actor/action/resource doesn't become a zero-row `''` match). **Documented v1 tradeoff:** `total` stays the unfiltered SP count while `entries` may be post-filtered shorter (an exact filtered count would require re-reading every page). **HIERARCHY_RESOURCE map reality:** today the audit middleware only writes `Project` (→SPACE) among hierarchy resources — `Folder`/`List` rows aren't produced by any audited route yet, so those map entries are inert-but-forward-compatible (object-level filtering lights up automatically when those mounts land); `Task`/workspace-level entries pass through (already covered by the workspace gate). GraphQL `activityFeed` resolver mirrors `views.schema.ts` authz exactly — `requireObjectLevel(VIEW)` on node scopes, `requireWorkspacePermission('workspace.read')` for EVERYTHING, UNAUTHENTICATED/BAD_REQUEST guards — so a non-member is rejected **before** any read (integration-pinned). Read-only lens: no mutations.

### Live prepend reuses the shared `taskEvents` topic (no new channel)
`activity-view.tsx` subscribes to the SAME `TASK_EVENTS` subscription the other view surfaces use (`@apollo/client/react` `useSubscription`, variables `{projectId, workspaceId}` from `LiveScopeProp`, `skip` when neither id is present), and maps each live event → a synthetic `AuditLogEntry` via the pure, unit-tested `taskEventToEntry` (created→CREATE / updated→UPDATE / deleted→DELETE; resourceId = `ev.task?.id ?? ev.taskId`; returns null when no id) + `prependEntry` (dedupe by id, cap 200). `Date.now()` is only called inside the event handler (never during render → no hydration mismatch). The canonical audit row lands on the next SSR re-seed; the synthetic entry's actor is blank client-side (the real actor isn't on the live payload).

### Embed URL guard — allow-list, server-normalized, now actually wired
Pure `normalizeEmbedUrl` (`modules/activity/embed-url.ts`): WHATWG `URL` parse → **allow-list** `http:`/`https:` only (canonicalize-then-reject neutralizes case/whitespace/embedded-scheme obfuscation like `  JaVaScRiPt:`), strips the fragment, throws `EmbedUrlError` on anything else (`javascript:`/`data:`/`vbscript:`/`file:`/`blob:`/scheme-relative/garbage/empty). **Plan gap closed:** the plan created the validator and its `embed-view.tsx` comment claimed "server-normalized at create/update time", but no task wired it — it was dead code. Wired into `view.service.create`/`update` for `type==='embed'` (validates + stores the normalized URL; `EmbedUrlError` → GraphQL `BAD_USER_INPUT` via the existing `toGraphqlError` helper), with two integration cases (reject `javascript:`, accept + normalize a fragment-bearing https URL). The iframe additionally carries `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"` + `referrerPolicy="no-referrer"` and `embed-view.tsx` does a defensive client-side scheme re-check. **Deviation (improvement):** chose `allow-popups` (popups stay sandboxed) over the plan's `allow-popups-to-escape-sandbox` (which is inert without `allow-popups` and *un*-sandboxes popups when paired) — strictly safer, still satisfies the e2e's `/allow-scripts/` assertion.

### Doc ships as a feature-flagged stub (plan rationale updated)
`doc-view.tsx` reads `config.docId` and renders a stub (`DOCS_FEATURE_ENABLED=false` in new `lib/feature-flags.ts`; `data-doc-stub="true"`). **The plan's rationale ("Phase 7 not present") is outdated** — Phase 7a/7b/7c have since landed — but the slice scope is unchanged: wiring the real reader is a deliberate out-of-scope follow-up. Comment updated to say so; the flag-ON branch is an unreachable documented TODO that imports no Phase 7 component (compiles clean today).

### Renderers registered + SSR seed
`view-surface.tsx`'s `ViewBody` switch gains `case 'activity'|'embed'|'doc'` before `default` (the 8 prior cases intact; not-yet-built `map`/`mindmap`/`chat` still fall through to ListView), with an `activityPage?: AuditLogPage|null` prop threaded Props→ViewSurface→ViewBody. The views `page.tsx` SSR-fetches `getActivityFeed` ONLY when `activeView?.type === 'activity'` (mirroring the capacity/gantt conditional fetches), passing `nodeScopeId` (null for EVERYTHING) + `workspaceId` to match the resolver's authz expectations. i18n `Activity`/`Embed`/`Doc` namespaces added to `apps/next-web/messages/{en,id}.json` (the real location — NOT `src/messages/`; real Indonesian), parity green.

### Verification (local Docker `ProjectFlow_Test`)
API **578 unit** (+37 = 15 embed-url + 22 activity-scope) / **279 integration** (64 files; +5 = 3 activity + 2 embed-url-wiring; 0 regressions, 370 SPs deploy 0 fail), web **174 unit** (+12 activity-entry) + en/id parity, `apps/api` tsc + `apps/next-web` next build both clean, **activity-embed-doc e2e 1/1** (Activity live-prepends a task-create `taskEvents` event; Embed renders the sandboxed iframe with src/sandbox/referrerpolicy; Doc renders the flagged stub).

### Residuals / follow-ups (non-blocking)
1. Doc view is a flag-gated stub — Phase 7 docs now exist, so a follow-up can flip `DOCS_FEATURE_ENABLED` and wire the real reader at the documented TODO.
2. Activity `total` is the unfiltered SP count (entries may be post-filtered shorter) — client pagination counts can be slightly off once Project entries are dropped; acceptable v1.
3. **Node-scoped (SPACE/FOLDER/LIST) activity feeds currently surface only audit rows for the node OBJECT ITSELF** — the SSR seed forwards `scopeId` as `resourceId` and the AuditLog has no subtree/path column, so the SP matches exact `ResourceId == scopeId` (a SPACE feed → rows for that Project row; Task CREATE rows have a null ResourceId and Task UPDATE rows carry the taskId, so contained-task events are NOT seeded). This is an intentional v1 narrowing (under-shows, never over-shows; the workspace gate + object-level post-filter keep it safe — note that simply dropping the resourceId filter would risk surfacing other scopes' Task events since `Task` passes through the post-filter). EVERYTHING is the fully-functional path today; the live `taskEvents` prepend works on any scope with a projectId. Proper subtree scoping needs a path-based audit filter (follow-up). The object-level post-filter's `Folder`/`List` map entries are inert until those audit mounts land.
4. `prependEntry` hardcodes the 200-entry cap (dropped the plan's `max` param) — one caller, fine.

### DB-execution policy
NO migration this slice; all DB work (SP deploy via globalSetup, integration, e2e dev servers) ran ONLY against local Docker `ProjectFlow_Test` — never the prod-pointing `apps/api/.env`. **Stop for review/merge before Slice 9f.**

## 2026-06-15 — Phase 9f (Map / Mind Map / Chat Views)

Adds the final three Views-Engine view types plus the greenfield `location` custom-field type the Map view needs: **map** (plots in-scope tasks carrying a `{lat,lng,label}` `location` value on free OpenStreetMap tiles; pin → task panel), **mindmap** (the `parent_task_id` subtree under the view's scope node as an expand/collapse node graph), **chat** (a task's comment stream as a channel with inline compose). Each is a client lens over an EXISTING data path — no parallel query: Map reuses `viewService.runView` (Phase-3 compiler) + decodes `location` client-side; Mind Map reuses the Phase-1 `usp_Hierarchy_DescendantTasks`; Chat delegates to the Phase-4 `commentService`. ONE CHECK-widening migration for `location`; Mind Map/Chat store only `config`.

### Migration renumbered 0050 → `0057_location_field` (CHECK-widen only, no table)
The plan predated 9a–9e (on-disk migration tip was **0056**), so `0050_location_field.sql` was renumbered to **`0057`**. It drops-then-recreates `CK_CustomFields_Type` (sys-catalog guarded, GO-batched) to append `'location'` to the exact `0035` lineage — a pure WIDEN, so every existing row still satisfies it. Reversible `rollback/0057_location_field.down.sql` restores the `0035` list (destructive only if a `location` row exists). Live-verified apply→rollback→re-apply (all exit 0, constraint `HAS_LOCATION`). The `location` value lives as JSON in `TaskCustomFieldValues.Value`; no new table. Local DB now **0057 / 370 SPs** (no new SP — Mind Map reuses `usp_Hierarchy_DescendantTasks`, Chat reuses comment SPs, Map filters the compiled page in service code).

### `location` field type — validator + the Zod-enum gap the plan missed
`CustomFieldType` gains `'location'`; `LocationValue {lat,lng,label}` added. The Phase-2 `validators.ts` gains a `case 'location'` (lat∈[-90,90], lng∈[-180,180], both finite via the existing `isFiniteNumber`; `label` must be a string; codes `NOT_LOCATION`/`BAD_LATITUDE`/`BAD_LONGITUDE`/`BAD_LABEL`) + 7 unit cases (incl. the absent-`label` case). **Critical the plan omitted (caught in review):** adding `'location'` to the union did NOT make it acceptable through the API — the REST `POST /custom-fields` hardcodes a Zod `TYPE` enum; without the token, create 422s before the validator ever runs. Added `'location'` to that enum (the only such list; `updateSchema` has no `type`). The integration test sets a value through the real `POST /custom-fields` + `PUT /tasks/:id/fields/:fieldId` path, exercising both the enum fix and the validator.

### Map = located filter over the compiled page; Mind Map = pure builder; Chat = comment mirror
- **`viewService.mapTasks`** runs `runView` (full object-level scope) then keeps rows whose `location` custom-field value (keyed by lowercased fieldId in `customFieldValues`) decodes via `parseLocationValue` (a read-side decoder mirroring the validator's range checks; tolerant of numeric strings + missing label → `''`, never plots a bad pin). GraphQL `mapTasks(viewId)` exposes `{taskId,title,status,lat,lng,label}`.
- **`viewService.mindMapGraph`** resolves the scope node and calls `repo.descendantTasks` → **`execSpOne`** (NOT the plan's `execSp`: `usp_Hierarchy_DescendantTasks` returns ONE `SELECT t.*` recordset; `execSp` returns array-of-recordsets and would feed the builder the wrong shape — matched `hierarchy.repository.ts`). The pure, unit-tested `buildMindMapGraph` re-roots out-of-scope/self-referencing parents, BFS-stamps depth, and is cycle-safe. EVERYTHING scope → empty graph. GraphQL `mindMapGraph(viewId)` → `{nodes,edges,rootIds}`.
- **`chat.schema.ts`** is a thin GraphQL mirror: `chatChannel(taskId)` → `commentService.list`; `postChatMessage(taskId,body)` → `commentService.create` (so mentions/watchers/fan-out/`comment:created` realtime all fire through the ONE existing path). `ChatMessage.createdAt` uses the registered `Date` scalar (matching `CommentType`/`AuditLogEntry`).

### Authz — fail-closed, mirrored from `viewTasks` (opus-reviewed clean, integration-pinned)
`mapTasks`/`mindMapGraph` copy `viewTasks`' exact branch verbatim: `const node = authzNode(view.scopeType); if (node) requireObjectLevel(ctx, node, view.scopeId, 'VIEW'); else requireEverythingWorkspace(ctx, view.workspaceId)` — gate runs BEFORE any read; the view's OWN scope authorizes the caller, so a foreign-workspace `viewId` resolves to no ACL → `notFound`/`forbidden`. Chat read gates `requireObjectLevel('LIST', taskListId, 'VIEW')` (null listId → `notFound`, fail-closed — a listless task has no chat-read path, the safe direction); Chat write gates `requireWorkspacePermission(comment.create)` — **an EXACT match to the REST `POST /comments` gate** (verified: that route is workspace-level only, no object-level gate, so the mirror introduces no new privilege). The owner-only green suite would miss cross-tenant holes, so the integration test adds a **non-member → DENY** case across all four resolvers (live 4/4).

### Frontend — leaflet client-only + the marker-icon bundler gotcha
`react-leaflet@5` (React-19-compatible) + `leaflet` on **free OpenStreetMap tiles** (no key, no geocoding — deferral). `MapContainer/TileLayer/Marker/Popup` load via `dynamic(ssr:false)` (`'use client'` alone doesn't stop App-Router SSR). The leaflet default marker icon is broken under bundlers → a client-only `useEffect` applies `L.Icon.Default.mergeOptions` from leaflet's bundled PNGs (handling Next's string/`{src}`/`{default}` asset shapes) so `.leaflet-marker-icon` actually renders (the e2e depends on it). **Map decodes `location` CLIENT-SIDE from the SSR `taskPage`** (via `taskFieldValue` + `parseLocationValue`) — so the dead `getMapTasks` SSR helper was removed in review (the `mapTasks` GraphQL resolver stays as a tested API surface). Mind Map fetches its graph via a `loadMindMapGraph` server action on mount (cancel-guarded, resets collapse state on view switch). Chat reuses `<CommentSection>` (a `<textarea>` placeholder "Add a comment…" + a "Comment" submit button). `view-surface.tsx`'s `ViewBody` switch gains `map`/`mindmap`/`chat` (workspaceId threaded in). i18n `Map`/`MindMap`/`ChatView` namespaces in `apps/next-web/messages/{en,id}.json` (real Indonesian, parity green). **Downstream union break fixed:** the `CustomFieldType` expansion made the web `FieldManager.tsx` `TYPE_LABELS` Record non-exhaustive → added a `location` label (+ `CustomFields.typeLocation` i18n).

### react-leaflet center/zoom note + StrictMode
`MapContainer` reads `center`/`zoom` only on first mount (react-leaflet semantics) — pins arriving live after mount don't re-center (v1: user pans; commented). StrictMode double-mount is safe (icon-fix is idempotent; `dynamic ssr:false` remounts get a fresh DOM node).

### Verification (local Docker `ProjectFlow_Test`)
API **588 unit** (+10 = location validator cases + 4 mindmap builder) / **283 integration** (65 files; +4 = map located-only, mindmap subtree, chat post→real comment, cross-tenant DENY; 0 regressions, 370 SPs deploy 0 fail), web **174 unit** + en/id parity, `apps/api` tsc + `apps/next-web` next build clean, **map-mindmap-chat e2e 1/1** (Map pin renders + click → panel; Mind Map collapse hides child / expand restores; Chat post → comment appears). Migration `0057` reversible + idempotent (live).

### Residuals / follow-ups (non-blocking)
1. **`location` field is API-provisioned this slice** — intentionally NOT offered in the `FieldManager` create dropdown (`TYPES` unchanged) and there is no in-task `CustomFieldCell` value editor for `location` (returns null), so offering "create a location field" with no way to populate it via UI would be a half-feature. The `TYPE_LABELS` entry stays so existing location fields display a proper label. Follow-up: a `{lat,lng,label}` value editor + `TYPES` entry to make Map self-serve in the UI.
2. **ChatView `currentUserId={null}`** — the views page doesn't thread a session user id; CommentSection tolerates null (posting works via the session cookie; edit/delete affordances are hidden). Follow-up: capture `requireSession()`'s user id and thread it through `ViewSurface`→`ViewBody`→`ChatView`.
3. Map doesn't re-center on live pins (react-leaflet first-mount center/zoom) — follow-up via a `useMap()` child.
4. Mind Map node-scope feed depends on `usp_Hierarchy_DescendantTasks` ListPath prefixing (same scoping the compiler uses); EVERYTHING scope → empty (no single node). `renderNode` is recreated per render (fine at task-hierarchy scale).
5. **Node-scoped Chat passes `workspaceId=null` to `CommentSection`** — the views page only sets `workspaceId` for EVERYTHING scope (SPACE/FOLDER/LIST pass `undefined`), so on a node-scoped chat view @-mention/assignment member autocomplete degrades (posting still works via the cookie; proven by integration + e2e). Same gap the Board surface already has ("workspaceId the surface doesn't thread yet"). Follow-up: thread the scope's workspaceId for node scopes.
6. Map/`mapTasks` fetch only page 1 (pageSize 25) — a view with >25 located tasks plots the first page only (the same pagination characteristic as every Views-Engine surface, not 9f-specific).

### DB-execution policy
ONE migration (`0057`, CHECK-widen) + SP deploy via globalSetup; all DB work (migration apply/rollback, integration, e2e dev servers) ran ONLY against local Docker `ProjectFlow_Test` — never the prod-pointing `apps/api/.env`. **Stop for review/merge before Phase 10.**

## 2026-06-15 — Phase 10a (Apps / Feature Toggles)

The **modularity layer**: a workspace/space/folder/list can turn optional features on/off. An app is a key in a **default-on code registry** (`apps/api/src/modules/apps/app-registry.ts` — 8 keys: time_tracking, multiple_assignees, sprint_points, nested_subtasks, dependency_warning, reschedule_dependencies, custom_task_ids[default OFF], email); `AppsEnabled` stores ONLY overrides; resolution walks the hierarchy ancestry (workspace→space→folder→list, the SAME `Path LIKE` scan `usp_ObjectAccess_Resolve` uses) and the **most-specific override wins**, else the registry default. A `requireApp(appKey)` REST middleware (+ GraphQL `assertAppEnabled`) returns a **404 feature-absent (`APP_DISABLED`)** — orthogonal to a 403 — and is retrofitted onto the optional Phase 2/5/8 features.

### Migrations renumbered 0051 → `0058_apps_enabled` (table) + `0059_app_perms` (RBAC); two-file convention
The plan predated 6a–9f (on-disk tip was **0057**). Renumbered to **0058** (the `AppsEnabled` table) + **0059** (the `app.manage` slug seed), following the two-file table/perms split 9a–9c adopted (`0051_dashboards`/`0052_dashboard_perms` etc.) rather than the plan's single combined migration. `AppsEnabled(Id, WorkspaceId, ScopeType, ScopeId NULL, AppKey, Enabled, UpdatedBy, CreatedAt, UpdatedAt)` with `UNIQUE(WorkspaceId, ScopeType, ScopeId, AppKey)` — **the workspace-root override carries `ScopeId = NULL`** (SQL treats NULL as one slot in a UNIQUE index → at most one workspace-level override per `(WorkspaceId, AppKey)`). `app.manage` seeded owner+admin ONLY (toggling availability is administrative; members/viewers cannot — and the 8b/8c/8e/9a "unseeded slug 403s even the owner" trap is avoided by seeding NOW). Live-verified apply→down→re-apply clean (idempotent + reversible). Local DB now **0059 / 372 SP files** (+2 read/write SPs; `usp_AppsEnabled_Set` MERGE-or-clear, `usp_AppsEnabled_ListForScope` ancestry override-chain).

### Resolver = pure most-specific-wins; the ancestry SP reuses the ACL scan
`usp_AppsEnabled_ListForScope` returns every `AppsEnabled` row on any ancestor (workspace Depth 0, Space 1, folders `LEN(Path)`, list 9999), NULL-safe-joined and filtered `ae.WorkspaceId = @WorkspaceId`. The pure `resolveAppEnabled(key, chain)` (unit-tested: default→ws→space→list, unknown-key fail-closed) picks the deepest override per key, else the registry default. `app.service` wraps it (`isEnabled`/`resolveAll`/`setToggle`/`scopeNodeForTask`); `requireApp` caches the chain on the Hono context per scope per request (mirrors `loadPermissions`). **Casing-defensive** throughout (`scopeNodeForTask` reads `.listId ?? .ListId`, `.projectId ?? .ProjectId`; repo `getWorkspaceId` fail-close to null → 404, never undefined).

### 404 feature-absent vs 403, composing in FRONT of requirePermission
`requireApp(appKey, resolveScope?)` resolves a scope node, fetches its chain, and on disabled/unresolvable returns **404 `APP_DISABLED`** — placed BEFORE `requirePermission` so a disabled feature reads as "does not exist here," distinct from a permission denial. An ENABLED app you lack permission for still 403s (composition verified).

### Split PATCH — `requireObjectAccess` 404s on a null resolver (plan assumed skip)
Reconciliation found `requireObjectAccess(min, resolver)` **returns 404 when the resolver returns null** (it does NOT skip — the plan's single-route design was wrong). So the toggle write is gated `app.manage` (RBAC, workspace resolved FROM the scope) + a conditional `requireFullOnScopeObject`: workspace scope → app.manage alone (no hierarchy object at the root); space/folder/list → ALSO `requireObjectAccess('FULL', …)`. Fail-closed verified (non-member, member-without-app.manage, app.manage-without-FULL all blocked for a sub-scope toggle; integration-pinned). **GET `/apps` + `/apps/:scope` gated `workspace.read`** (a DEVIATION — the plan left reads open; gated for REST↔GraphQL parity, closing the recurring "GraphQL gated, REST ungated IDOR" class). Cross-tenant traced safe: `GET /apps?workspaceId=&scopeId=` authorizes the query `workspaceId` and the SP filters overrides by it, so a foreign `scopeId` contributes nothing (incoherent-but-safe, no leak); the path-param routes resolve workspace FROM the scope (gate-ws == target-ws, no TOCTOU).

### Retrofits — route gates + two service-layer gates
- **time_tracking** → `requireApp('time_tracking', …)` first on worklog `POST /`, `GET /`, `timer/start`, `tasks/:taskId/estimate`, `tasks/:taskId/rollup`, `PATCH /:id`, `DELETE /:id` (PATCH/DELETE resolve the task via `worklogRepo.getById().TaskId`). `timer/stop` + `timer/active` are **intentionally ungated** (user-centric: you can always stop/inspect your OWN running timer; neither creates logged time under a disabled scope).
- **multiple_assignees** → first middleware on `PUT /:id/assignees` (coexists with the pre-existing `MultipleAssigneesDisabledError` Space-setting — `requireApp` 404s first when off).
- **nested_subtasks** → a conditional `requireNestedSubtasksIfParent` wrapper on `POST /tasks` that gates ONLY when `parentTaskId` is present (resolving scope from the parent).
- **dependency_warning** → first middleware on the dependency EDGE routes (GET/POST/DELETE `/:id/dependencies`) AND **warning suppression** in `PATCH /:id/transition`: `transitionTask` gained an optional `{ ignoreDependencyWarning }` (the reconciliation confirmed it had NO bypass); the route catches `DependencyWarningError`, checks `isEnabled('dependency_warning', taskScope)`, and when OFF re-runs the transition with the bypass (only `assertNoOpenBlockers` is skipped — required-custom-fields still enforced; scope is the task's own). NOTE: gating the edge CRUD on `dependency_warning` is slightly broad (the app names the *warning*) but the registry has no separate "dependencies" app — accepted + documented.
- **reschedule_dependencies** → the cascade lives in `task.service.updateTask` (not a route), so it is gated THERE: the base date update always runs; only `rescheduleDependents` is wrapped in `isEnabled('reschedule_dependencies', scope)`.
- **Inline-noted, NOT fabricated** (confirmed still absent on-disk): **sprint_points** (story points ride the generic task update, no dedicated route), **custom_task_ids**, **email** (Phase 12) — each with the exact gate to apply when it lands.
- No circular import: `task.service → app.service → task.repository` is acyclic (app.service imports the repos, not task.service).

### GraphQL mirror + the write-validation parity fix
`appToggles(scopeType,scopeId)` (gated `workspace.read`) + `setAppToggle` (gated `app.manage` + object-FULL for sub-scopes), one shared `appService`. `assertAppEnabled('time_tracking', scopeNodeForTask(taskId))` added to the 4 taskId-bearing worklog GraphQL resolvers (taskWorkLogs/taskTimeRollup/startTimer/createWorkLog); `updateWorkLog`/`deleteWorkLog` (worklog-id args) left ungated in GraphQL — a documented parity gap (REST gates them; service enforces author-ownership). **Final-review fix (I1/I2): both REST PATCH and GraphQL `setAppToggle` now reject an unknown app key AND a write at a scope the app does not declare `overridableScopes`** (the registry is the authority; the UI already hides those switches, but the API accepted them and the deepest-wins resolver would honor an over-reaching list-level `email` override).

### Frontend — App Center grid + the TaskDrawer gate
`AppCenter.tsx` (client) fetches `loadAppToggles` and renders a switch per registry app (live only where `overridableScopes` includes the scope; `data-app="<key>"` rows for the e2e), refetching after its own toggle. Mounted at the **workspace** scope in `workspace-settings-view.tsx` (an "Apps" card). `isAppOn(apps, key)` (fail-closed). `TaskDrawer` resolves the task's scope (list, falling back to space) on mount and **hides the whole time-tracking section** (estimate bar + worklog) when time_tracking is off — `timeTrackingOn` defaults TRUE (optimistic; the API is the real boundary, so a brief show-then-hide on the rare off-case is fine; Playwright `toHaveCount(0)` retries through it). The GlobalTimerWidget (header) stays ungated (user-centric, like timer/stop). **No realtime publish on toggle** — there is no client subscriber; adding an unconsumed pubsub channel would be dead code (9e lesson), so the plan's `app:toggled` publish was dropped and live cross-client refresh-on-toggle deferred (the editor refetches locally; other pages re-resolve on navigation/SSR).

### The C1 i18n miss the final opus review caught (process lesson)
Batch G's i18n insert used a node text-splice whose anchor (`{\n  "DashboardCards"`) spanned a newline — but the message files are **CRLF**, so the AppCenter anchor silently no-op'd while the single-line `settingsApps` anchor matched. The script then printed a **hardcoded** "AppCenter present" log instead of verifying → a false green. The en/id parity test passed (both files missing AppCenter *equally*), the build passed (next-intl missing keys don't fail the build), and the e2e passed (it selected by `data-app`, never by label text). The **final opus whole-slice review caught it** (CRITICAL). Fixed with a CRLF-aware splice that REALLY verifies (`JSON.parse` + 8-key + parity assertions, exits non-zero on failure) AND an e2e `toContainText(/time tracking/i)` label guard that would have caught it. Lesson reaffirmed: a success *log* is not *verification* — assert the post-condition.

### Verification (local Docker `ProjectFlow_Test`)
API **598 unit** (+10 = 7 resolver + 3 requireApp) / **286 integration** (66 files; +3 apps = time_tracking feature-absent-under-disabled-Space + sibling-intact + re-enable + non-FULL-toggle-403 + multiple_assignees task-route gate; 0 regressions, 372 SPs deploy 0 fail), web **174 unit** + en/id parity, `apps/api` tsc + `apps/next-web` next build clean (full turbo 2/2), **app-toggles e2e 1/1** (App Center UI flips time_tracking off → inherited to the task's list scope → drawer hides the section → re-enable restores; label guard proves the i18n renders). Migrations 0058/0059 reversible + idempotent (live).

### Residuals / follow-ups (non-blocking)
1. **GraphQL `updateWorkLog`/`deleteWorkLog` not time_tracking-gated** (REST is; service enforces author-ownership) — GraphQL parity gate is a documented follow-up.
2. **TaskDrawer UI gate resolves at list→space scope; folder/list-level time_tracking overrides hide the UI surface only via the list scope** — the API enforces correctly at the list scope regardless; the UI gate is a UX nicety, not the boundary.
3. **No live cross-client refresh on toggle** (no pubsub consumer) — the App Center refetches locally; other surfaces re-resolve on navigation/SSR.
4. **No App Center mount below the workspace scope** this slice — toggles at space/folder/list are reachable via REST/GraphQL but the only UI mount is workspace settings (the plan's scope).
5. `M1` incoherent-but-safe `GET /apps?workspaceId` vs foreign `scopeId` (no leak; optional 400-on-mismatch tightening).

### DB-execution policy
TWO migrations (`0058` table, `0059` perms) + 2 SPs deployed via globalSetup; all DB work (migration apply/rollback, integration, e2e dev servers) ran ONLY against local Docker `ProjectFlow_Test` — never the prod-pointing `apps/api/.env`. **Stop for review/merge before Slice 10b (Permissions Hardening).**

---

## 2026-06-15 — Phase 10b (Permissions Hardening)

Made the already-strong permission core **user-manageable and provably correct**: workspace-scoped **custom roles**, a **per-object permission editor** over the existing `ObjectPermissions` ACL, **audit-on-every-mutation**, and the headline **permission test matrix**. No new ACL table; custom roles are just `Roles` rows with `WorkspaceId` non-NULL flowing through the unchanged `RolePermissions`/`UserRoles`/`usp_UserPermissions_Get` union.

### Mechanism choices
- **`Roles.WorkspaceId`** (NULL = the 7 system/global roles; non-NULL = a workspace custom role) + `FK_Roles_Workspace`. Slug uniqueness made **scope-aware**: the global `UQ` constraint (autogen name, dropped dynamically) replaced by two filtered unique indexes — `UQ_Roles_Slug_System` (Slug WHERE WorkspaceId IS NULL) + `UQ_Roles_Slug_Workspace` ((WorkspaceId,Slug) WHERE WorkspaceId IS NOT NULL). Two new WORKSPACE permission slugs `role.manage` + `object.permission.manage` seeded + granted to workspace-owner/admin.
- **`accessService.setObjectPermission(...)`** is the **reusable grant primitive** — 10c (request-access grants) and 10d (guest grants) call this exact audited method; signature kept stable.
- **Per-object editor reuses `ObjectPermissions` + `usp_ObjectAccess_Resolve`** (most-specific-wins over the membership floor + Visibility PRIVATE) — NO new ACL table. `usp_ObjectPermission_ListForObject` walks the SAME ancestry the resolver does (Space→ancestor Folders by Path prefix→the object) to compute the "inherited from `<ancestor>`" indicator. New `usp_ObjectPermission_Remove` (adds `@@ROWCOUNT` for audit + 404) sits beside the existing silent `usp_ObjectPermission_Unset`.
- **Every** role + grant mutation writes an `AuditLog` row via a shared best-effort `writeAccessAudit` → `usp_AuditLog_Create` (auditing never fails the operation).
- REST (Hono, primary, `/admin/workspaces/:workspaceId/roles*` gated `role.manage` + `/access/:objectType/:objectId/permissions` gated `requireObjectAccess('FULL')`) + a GraphQL mirror (`workspaceRoles`/`objectPermissions` + custom-role CRUD/assign + `setObjectPermission`/`removeObjectPermission`) over the ONE shared `roleService`/`accessService`, fail-closed via `requireWorkspacePermission`/`requireObjectLevel`.
- **THE permission test matrix** (`permission-matrix.integration.test.ts`, §5.5 acceptance): the full cross-product **{owner, admin, member, viewer, custom-role, guest} × {none, VIEW@space, VIEW@folder, VIEW@list, COMMENT@list, EDIT@list, FULL@list, EDIT@space} × {PUBLIC, PRIVATE}** = 96 enumerated assertions on `usp_ObjectAccess_Resolve`'s resolved LIST level. Proves a more-specific explicit grant WINS over the role floor (`COALESCE(@Explicit,@Floor)`): a member's EDIT floor is downgraded by `VIEW@list` and upgraded by `FULL@list`; the floor is **membership-based** (owner→FULL, any member→EDIT, non-member→none, role-independent); PRIVATE denies a non-member only WITHOUT an explicit grant.

### Reconciliation deltas (the plan predated phases 6–10a)
- Migration renumber **plan `0052` → `0060_custom_roles`** (on-disk tip was 0059). Local DB now **0060 / 377 SP files** (+5: Role_ListForWorkspace, ObjectPermission_Remove, ObjectPermission_ListForObject, Hierarchy_NodeWorkspace, Project_SetVisibility).
- **Test-harness shape**: `createTestUser` returns `{user:{Id,Email}, accessToken}` — NOT `{id}`; every test uses `owner.user.Id`. The `/lists`/`/folders` create responses are PascalCase → read `list.id ?? list.Id`.
- **`/admin/permissions` is `admin.roles.manage`/super-admin-gated** → added `GET /admin/workspaces/:workspaceId/permissions` (gated `role.manage`) + `loadWorkspacePermissions` action so a workspace owner managing custom roles can read the WORKSPACE permission catalog.
- **No `/lists/[listId]/settings` route existed** → created a minimal one mounting `<ObjectPermissionEditor>`; the editor gained a minimal add-grant form (user-id + level). `usp_Role_GetBySlug` scoped to `WorkspaceId IS NULL` (deterministic system-role lookup now that custom slugs may collide).
- **truncate.ts FK-547 guard**: the `Roles` catalog is preserved across tests but custom roles FK `Workspaces`; added a guarded pre-step deleting `UserRoles` + custom roles before the loop's `DELETE FROM Workspaces`.

### Adversarial security review
opus reviewed the REST surface (Task 5) and the GraphQL mirror (Task 9) — both **airtight, gate-first, no cross-tenant holes**: object editor FULL-gated and fail-closed; role routes resolve the workspace from the PATH (+ service guards bind the role to that workspace); grant writes derive the workspace from the object via `getWorkspaceIdForNode` (never caller input). **One real gap the integration test caught**: Task 5 mounted `/access` but missed `app.use('/access/*', authMiddleware)` → the editor routes were unauthenticated (401) → fixed. Documented non-blocking follow-ups: `usp_ObjectPermission_Set` trusts the caller `@WorkspaceId` on INSERT (the only caller derives it authoritatively — a defense-in-depth SP-side validation is a future hardening); the editor's add-grant takes a raw user-id (a member/user picker is a 10c polish); GraphQL `updateWorkspaceRole`/etc. return Boolean.

### DB-execution policy
ONE migration (`0060`) + its rollback (idempotency + reversibility live-verified: apply→re-apply no-op→down→re-apply, perms 2/0/2, column PRESENT/MISSING/PRESENT) + 5 new SPs. All DB work (migration, SP deploy, integration, e2e dev servers) ran ONLY against local Docker `ProjectFlow_Test` — never the prod-pointing `apps/api/.env`. Verified: **API 602 unit / 389 integration (69 files, +103, 0 regressions), web 177 unit + en/id parity, apps/api tsc + Next build clean, permissions-hardening e2e 1/1**. **Stop for review/merge before Slice 10c (Share Links).**

---

## 2026-06-15 — Phase 10c (Public Share Links + Request Access)

Added the **external-access layer**: a scoped, high-entropy, **read-only** share token granting access to **exactly one object** (task / saved view in v1) at `VIEW` level and nothing else — resolved by a **separate unauthenticated REST route group** that serves a **navigation-stripped, write-stripped projection** rendered by a **public Next route outside `(app)`**. Plus the inverse **request-access** flow: an authed non-member creates an `AccessRequests` row + a Phase 3.5 notification to the object's owners/admins, who grant via the **10b `setObjectPermission`** primitive (writing an `ObjectPermissions` row on the task's List). Migration **0061** (table tip was 0060); DB now **0061 / 386 SP files** (+9). Stop-for-review before 10d (Guests).

### Data model + token
- `ShareLinks(Id, WorkspaceId, ObjectType ∈ task|doc|dashboard|view|whiteboard, ObjectId, Token NVARCHAR(64) UNIQUE, Level DEFAULT 'VIEW', ExpiresAt, CreatedBy, CreatedAt, RevokedAt)` + `AccessRequests(Id, WorkspaceId, ObjectType, ObjectId, RequestedBy, Note, Status pending|granted|denied, ResolvedBy, ResolvedAt, CreatedAt)`. Idempotent + reversible (apply→down→re-apply proven on `ProjectFlow_Test`). Seeds `share.create` + `share.revoke` slugs → workspace-owner/admin.
- **Token is high-entropy random — NOT a GUID:** `randomBytes(48).base64url` = 64 chars, stored in the `UNIQUE` `Token` column so `usp_ShareLink_Resolve` looks it up by an **indexed equality** (no scan, no per-byte secret comparison). `usp_ShareLink_Resolve` is **live-only** — it filters `RevokedAt IS NULL AND (ExpiresAt IS NULL OR ExpiresAt > SYSUTCDATETIME())`, so the unauthenticated path can never resolve a dead link; the pure `isLinkLive` helper re-asserts the same predicate in code (belt-and-suspenders, unit-pinned).
- One pending request per `(ObjectType, ObjectId, RequestedBy)` via a filtered unique index; `usp_AccessRequest_Create` returns the existing pending row on a repeat (idempotent).

### The membership-free public resolver (the decisive safety property §2.2)
- `shareService.resolvePublic(token)` resolves token → `(object, level=VIEW)` and serves a read-only projection **without ever calling `accessService`/membership/`usp_ObjectAccess_Resolve`/the tree**. `share.projection.ts` (pure, unit-tested) strips **write keys** (`editUrl/actions/canEdit/mutationUrl/assigneeId/assignees/reporterId`) and **navigation keys** (`listId/folderId/spaceId/projectId/workspaceId/parentTaskId/breadcrumb/siblings/ancestors/scopeId/scopePath`) so there is no path up the tree and no workspace context. v1 builds **task + view** projections; **doc/dashboard/whiteboard stay graceful stubs → 404** (those modules now exist on-disk but wiring their read-only projections is a documented follow-up, matching the 9e Doc-view precedent and the plan's task-focused §6.5 acceptance).
- **Route posture (server.ts):** `/public/share/:token` (publicShareRoutes) is mounted **BEFORE** the `authMiddleware` block (no JWT, no audit), beside `/auth`/`/avatars`/`/forms/public`; the authed `/share` + a second `/access` router are mounted AFTER with `authMiddleware` (+ `auditMiddleware`). `/public/share` does not match `app.use('/share/*', authMiddleware)`.

### Authz — FULL-on-object, authorize-THEN-mutate
- All sharing/grant endpoints require **`FULL` on the object** (a task share/grant resolves to its containing **LIST** — the ACL only knows SPACE/FOLDER/LIST, §9 deferral 4) via `accessService.can(userId,'LIST',listId,'FULL')`, fail-closed. Create also gates the `share.create` slug.
- **Revoke + access-request-resolve are authorize-THEN-mutate:** the route reads the link/request via the non-mutating `usp_ShareLink_GetById`/`usp_AccessRequest_GetById`, asserts FULL, THEN mutates — an integration test proves a non-FULL caller gets 403 with **no `RevokedAt`/`ObjectPermissions` write**.
- **Opus review fix (the payoff):** `resolveRequest` originally branched on the input `decision`, so a stale id for an already-`denied` request could be flipped to a grant. Fixed: `usp_AccessRequest_Resolve` returns the row **only when it transitioned a pending row** (`IF @@ROWCOUNT=0 RETURN`) and the service branches on the **SP-returned `status`** — a denied→grant flip via a stale id is now impossible. request-access notify is best-effort (a notification hiccup never fails the persisted request) and the route maps only the `OBJECT_NOT_FOUND` sentinel to 404 (real 500s surface).

### request-access → notification → 10b grant
`accessRequestService.requestAccess` creates the row + notifies the workspace owners/admins (`usp_Workspace_ListOwnerAdminIds`) with a free-form `ACCESS_REQUESTED` type (Notifications.Type is NVARCHAR, no CHECK). On grant, `resolveRequest` calls **10b's `accessService.setObjectPermission({...,actorId})`** to write an `ObjectPermissions` row on the task's List (default `EDIT`) and notifies the requester `ACCESS_GRANTED`. **KEY FINDING (for 10d):** granting a non-member an `ObjectPermissions` row DOES resolve to an effective ACL level (`usp_ObjectAccess_Resolve` returns `@Explicit` for non-members over a null role floor), BUT data endpoints scope by membership and there is no `GET /lists/:id`, so a non-member's practical data reach stays limited until they're a member/guest (Phase 10d's job) — the integration test asserts the grant via the 10b `GET /access/:type/:id/permissions` endpoint (the DoD's actual requirement), not a list GET.

### Frontend
- **Public route `app/share/[token]/` sits OUTSIDE `(app)`** (sibling of `login`/`register`/`forms`), so the protected `(app)/layout.tsx` (which calls `getMe()`) never wraps it. `page.tsx` is **`export const dynamic = 'force-dynamic'`** (a revoked/expired token must never be served from a cached render) and SSR-fetches via the **cookieless** `@/server/public/share.ts` helper (plain `fetch` to `/api/v1/public/share/:token`, mirrors `@/server/public/forms.ts`); `params` is awaited (Promise). `PublicObjectRenderer` is a server component: read-only, no `<nav>`, no write affordances, i18n'd field labels.
- **Proxy `auth-decision`** allowlists `/share` in `PUBLIC_PREFIXES` (the exact 7c `/forms/public` precedent) — without it the sessionless visitor was 302'd to `/login`; the prefix-collision guard keeps `/sharex` protected (+ unit test).
- Server actions (`server/actions/share.ts`) use the canonical `requireSession` + **`serverFetchBody`** (the `/share` + `/access` endpoints return bare `{link}/{links}/{request}`, NOT the `{data}` envelope) + `toActionError` + `ActionResult<T>`. `ShareModal` (opened from the **TaskDrawer header**) toggles/copies/revokes a public link; `RequestAccessPanel` sends a request. `notification-meta.ts` gained `ACCESS_REQUESTED`/`ACCESS_GRANTED` `TYPE_META`; `Share` + `AccessRequest` namespaces + 4 Inbox keys added en/id (real Indonesian, parity green). i18n at `apps/next-web/messages/` (NOT src/).

### Reconciliation deltas (the plan predated phases 6–10b — see `docs/superpowers/plans/2026-06-15-phase10c-RECON.md`)
- Migration renumber **plan `0053` → `0061_share_links`**. 9 SPs (not the plan's 6): + `usp_ShareLink_GetById` / `usp_AccessRequest_GetById` (authorize-then-mutate reads) + `usp_Workspace_ListOwnerAdminIds` (notification fan-out). `accessService.setObjectPermission` is an **OBJECT param incl. `actorId`** (plan's positional call was wrong). `taskRepo`/`viewRepo.getById` return mapped **camelCase** (recon agent wrongly said PascalCase) → projection builders are casing-tolerant. POST `/lists`+`/tasks` return `{data}` PascalCase; `createTestUser` → `{user:{Id},accessToken}`.

### Frontend review + e2e fixes
The typescript-reviewer batch was **spec-clean** (all 6 checks PASS); applied quality polish (expiry guard against `RangeError`, `useCallback` refetch + surfaced initial-load failure, copy-button feedback + handled rejection, i18n'd field labels). **The live e2e caught 2 real bugs:** (1) `ShareModal` overlay `z-index:60` sat **behind** the `TaskDrawer` (overlay 100 / panel 101) so its clicks were swallowed → raised to 200 (a real user would have hit this too); (2) the share page is now `force-dynamic` so a revoked token is never served from Next's route cache. The e2e's revoke assertion hits the membership-free `/public/share/:token` resolver directly (the authoritative security boundary), deterministic vs Next's dev route cache.

### DB-execution policy
ONE migration (`0061`) + rollback + 9 SPs — all DB work (migration apply/rollback/re-apply, SP deploy, integration, e2e dev servers booted by Playwright with a shell-exported local DB env overriding the prod-pointing `apps/api/.env`) ran ONLY against local Docker `ProjectFlow_Test`. Migration level **0061**, SP count **386**. Verified: **API 614 unit / 397 integration (8 share tests), web 178 unit + en/id parity, apps/api tsc + Next build clean, share-links e2e 1/1** (anon read-only render, no nav, no list/workspace-id leak, revoke→resolver 404). **Stop for review/merge before Slice 10d (Guests).**

---

## 2026-06-15 — Phase 10d (Guests & Limited Members) — FINAL Phase 10 slice

External-access membership: a **guest** (external, non-org-email) and a **limited member** (internal, org-email) are `WorkspaceMembers` rows that contribute **no floor**, so the existing object-ACL resolver returns "no access" for everything they were not explicitly granted — the Space tree is invisible by construction. (Plan `2026-06-07-phase10d-guests.md`; reconciliation `2026-06-15-phase10d-RECON.md` — the plan predated 6a–10c so migration number, the resolver SP, and several helper names diverged.)

### Mechanism — no-floor resolver
`usp_ObjectAccess_Resolve` gains a `@IsGuest` detection (the subject holds `workspace-guest` or `workspace-limited-member` in this workspace via `UserRoles`→`Roles`; the denormalized `WorkspaceMembers.IsGuest` is a fast-path corroborant, the role is authoritative). The floor CASE becomes `owner→FULL, GUEST→NULL (above member), member→EDIT` so a guest's EDIT membership floor never leaks. For an ungranted-but-existing object `COALESCE(@Explicit,@Floor)=NULL` with `Found=1` → caller returns **403, not 404**. Everything else (ancestry scan, explicit-grant pick, PRIVATE early-return) is byte-for-byte unchanged. The prior SP redeploys cleanly (reversible).

### Atomic accept + invite/grant guards
`usp_GuestInvite_Accept` does the whole accept in ONE transaction: upsert the guest `WorkspaceMembers` row (`IsGuest=1`) + the `UserRoles` assignment + the `ObjectPermissions` grant (same write `usp_ObjectPermission_Set` performs) + flip the invite to `accepted`; it pre-validates pending/expiry (THROW 51411/51412) as the race-safe backstop. The standalone 10b `setObjectPermission` is retained as the admin grant primitive (NOT a second out-of-transaction call). Two **service-layer pure guards** (unit-tested, no DB): an **org-email** invite (domain matches `Workspaces.VerifiedDomain`) is promoted to `workspace-limited-member`; a **guest may not be granted Space scope** → `GuestObjectScopeError` → **422**. Token = `randomBytes(32).base64url` (256-bit). `Workspaces.VerifiedDomain` is greenfield (Workspaces had no domain col; SSO/directory identity remains a Phase-9.3 deferral) — added a column + `usp_Workspace_GetVerifiedDomain` + `@VerifiedDomain` on `usp_Workspace_Update` + a PATCH `/workspaces/:id` field.

### Surfaces + defense-in-depth
REST primary (`POST /guests/invites` gated **FULL on the object**; `POST /guests/invites/:token/accept` enforces invite-email == authed-email via `AuthRepository.getUserById` PascalCase `.Email`; `GET /guests` + `DELETE /guests/:userId` + `DELETE /guests/invites/:inviteId` gated `guest.manage`) + a GraphQL mirror (`workspaceGuests`/`inviteGuest`/`acceptGuestInvite`/`revokeGuest`) delegating to the ONE `guestService` with byte-identical gates. **Tree-listing defense-in-depth:** `accessService.filterVisibleNodes(userId,type,nodes)` spliced into `GET /lists`, `/folders`, `/projects` — drops ungranted nodes for a guest, a **no-op for full members** (their floor passes every node), and can only ever REMOVE nodes. The two seeded `IsSystem=1` WORKSPACE roles (WorkspaceId NULL) hold only `task.read`+`comment.*own` — NO `workspace.read`/`members.read`, so a guest can't enumerate the tree or member list. Migration renumbered plan-`0054`→**`0062_guests`**; local DB now **0062 / 392 SP files** (+6 new files: `usp_GuestInvite_Create/Accept/List/Revoke/GetByToken` + `usp_Workspace_GetVerifiedDomain`; `usp_ObjectAccess_Resolve` + `usp_Workspace_Update` modified in place). `truncate.ts` gained `GuestInvites`.

### Security review fixes (code-reviewer pass on the routing batch)
(1) **`filterVisibleNodes` fails closed** — a per-node `resolveOrNull` throw now drops that node (was: whole-listing reject → 500 for everyone incl. members). (2) **`GET /projects/:id` was an ungated IDOR** (a guest could fetch a Space record directly, bypassing the tree filter) → now `requireObjectAccess('VIEW','SPACE')`; the added middleware broke Hono path-param inference so the handler reads `c.req.param('id')!`. (3) **Accept route returns clean 409/410** for non-pending/expired (SP remains the atomic backstop). Frontend: the **accept page redirects to the granted object** (`LIST→/lists/:id`, `SPACE→/projects/:id`) — a guest granted only a List can't reach it via the now-filtered sidebar tree, so the redirect is the navigation path.

### Accepted residuals / documented limitations (for the final review + follow-ups)
- **Pre-existing single-resource/list IDORs NOT closed by 10d (codebase-wide, affect every authed user, not a 10d regression):** `GET /tasks?projectId=` and `GET /tasks/:id` have NO object/membership gate. 10d delivers the DoD's **tree** invisibility (spaces/folders/lists listing + the Space record), but a guest — like any authed user — can still hit those ungated task endpoints. A dedicated hardening slice should gate them object-VIEW (mirrors `/tasks/:id/fields`, which already gates VIEW on the task's list). Flagged loudly here so it isn't mistaken for a guest-isolation gap introduced by this slice.
- `GuestManagementPanel` + server actions + i18n are **built and unit-clean but the panel is not mounted** on `/workspaces/[id]/members` (needs an `objectOptions` hierarchy loader) — page-wiring follow-up, matching the 8b/8c deferral pattern. The guest flow (invite via API/GraphQL → accept page → granted object) is fully functional + e2e-proven without it.
- `Workspaces.VerifiedDomain` is a lightweight manual field (no SSO/directory verification) — Phase-9.3 deferral.

### DB-execution policy + verification
All DB work (migration apply→rollback→re-apply [reversible+idempotent], SP deploy, integration, e2e dev servers via shell-exported local env) ran ONLY against local Docker `ProjectFlow_Test`; the prod-pointing `apps/api/.env` was never used. Verified: **API 622 unit / 402 integration (72 files; +guest.pure 8 unit, +guests 3 / guest-resolver 2 integration; 0 regressions), web 178 unit + en/id parity, apps/api tsc + Next build clean, guests e2e 1/1 live** (external invite → accept → redirect to the granted List; sibling List + Space record + Space enumerate all 403). **Phase 10 (and the 6→10 build arc) is now CODE-COMPLETE.**
