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
