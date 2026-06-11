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

### DB-execution policy

All DB work (migration apply/rollback/re-apply, SP deploy, integration, e2e dev servers) ran ONLY against local Docker `ProjectFlow_Test` — the e2e dev servers were booted by Playwright with a shell-exported local DB env that overrides the prod-pointing `apps/api/.env` (Node `--env-file` precedence). Migration level **0043**, SP count **312**. Verified: API **458 unit / 221 integration** (52 files), web **120 unit** (+ en/id parity), API+web builds clean, time-tracking **e2e 1/1**.
