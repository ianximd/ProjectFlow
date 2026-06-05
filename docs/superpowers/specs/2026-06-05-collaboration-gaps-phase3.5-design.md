# Design: Phase 3.5 — Collaboration Gaps (BUILD_PLAN P4 residual)

**Date:** 2026-06-05
**Roadmap source:** `docs/superpowers/specs/2026-06-03-clickup-hierarchy-design.md` §1 — "3.5 | Collaboration gaps | P4 (residual) | assigned comments, @mention→follower+notification, **Inbox** (unread/by-type/save-for-later), **presence**"
**Predecessors:** Phase 1 (hierarchy), Phase 2 (custom fields + watchers), Phase 3 (views engine) — all merged to `main`.

---

## 0. Scope decisions (locked with user)

- **Full scope, including presence.** Phase 3.5 builds notification depth, assigned/resolved comments, a real Inbox, a frontend realtime client, AND presence (viewers + typing). Presence is net-new realtime infrastructure, not a residual gap.
- **Realtime transport: Apollo Client + SSE.** Add `@apollo/client` to the Next.js app, consuming the existing GraphQL Yoga SSE subscriptions. Apollo is used **only** for live subscriptions and the few live queries — the existing SSR + server-action data path is NOT migrated.
- **Confirmed sub-decisions:** decompose into 3 slices (3.5a/b/c); mentions encoded as structured tokens `@[Name](userId)`; auto-watch on commenting is IN; deferrals (mute/prefs, board/list presence, comment threading UI, email delivery) accepted.

---

## 1. Ground truth — what already exists (audit, 2026-06-05)

Corrects the roadmap's "comments/notifications/pubsub already built" assumption with file-level reality.

| Capability | Status | Evidence |
|---|---|---|
| Comments + threading | ✅ DB+SP+API; `ParentId` in DB only (no UI) | `infra/sql/migrations/0004_comments.sql`; `apps/api/src/modules/comments/*`; `apps/api/src/graphql/schema.ts` (CommentType ~248-258) |
| Reactions | ✅ fully built incl. UI | `CommentReactions` in `0004`; `usp_Comment_React.sql`; `apps/next-web/src/components/CommentSection.tsx` (~131-142) |
| @Mentions | ❌ no body parsing, no notification, no watcher | `MENTION` is a frontend-only label in `notifications-view.tsx` |
| Notifications | ✅ backend; only `TASK_ASSIGNED` + `COMMENT_ADDED` ever created; frontend view mostly hardcoded mockup | `infra/sql/migrations/0006_notifications.sql`; `apps/api/src/modules/notifications/*`; `apps/api/src/graphql/schema.ts` (~120-268); `apps/next-web/src/app/(app)/notifications/notifications-view.tsx` |
| Watchers | ✅ fully built (DB+SP+API+UI); NO auto-watch; NOT in fan-out | `infra/sql/migrations/0030_custom_fields.sql` (~68-77); `apps/api/src/modules/watchers/*`; `apps/api/src/graphql/watchers.schema.ts`; `apps/next-web/src/components/WatcherControl.tsx` |
| Pubsub / SSE | 🟡 backend fully wired (Yoga+Redis); `taskUpdated`/`commentAdded` subs + 7+ publish channels; **frontend never consumes** | `apps/api/src/graphql/pubsub.ts`, `yoga.ts`, `schema.ts` (~546-569) |
| Presence | ❌ absent entirely | — |
| Inbox | 🟡 notifications page exists; unread/all tabs + mark-read only | `apps/next-web/src/app/(app)/notifications/` |
| Frontend realtime client | ❌ none (pure SSR + server actions/REST) | no Apollo/WS/SSE client in `apps/next-web` |

**Key architectural fact:** the frontend has no realtime client; the backend SSE subscriptions are effectively dead code. Presence and live push are therefore new frontend architecture, not gap-filling.

**Fan-out today:** `notificationService.notify()` is called from `task.service.ts` (assignment → new assignees) and `comment.service.ts` (comment → reporter + assignees). Watchers are never included.

---

## 2. Decomposition — one spec, 3 dependency-ordered slices

Each slice is independently mergeable and verifiable.

- **3.5a — Notification depth** (backend + minimal UI, zero realtime risk): mention parsing, auto-watch, watchers-in-fan-out, assigned/resolved comments.
- **3.5b — Realtime client** (Apollo + SSE): live notification bell + live comments.
- **3.5c — Inbox + Presence**: Inbox rework (by-type + save-for-later), presence (viewers + typing).

---

## 3. Data model — migration `0033_collaboration.sql` (+ down)

All changes carry `WorkspaceId` lineage through existing FKs (Comments→Tasks→Lists→…→Workspace; Notifications.UserId scoped per-user). New objects follow the SP-per-operation pattern (see Phase 2/3 `DECISIONS.md`).

**`Comments` — add columns:**
```
AssignedToId   UNIQUEIDENTIFIER NULL  -> Users(Id)     -- assigned comment (action item)
ResolvedAt     DATETIME2        NULL                   -- resolved thread/comment
ResolvedById   UNIQUEIDENTIFIER NULL  -> Users(Id)
```

**`CommentMentions` — new table:**
```
CommentId        UNIQUEIDENTIFIER NOT NULL -> Comments(Id) ON DELETE CASCADE
MentionedUserId  UNIQUEIDENTIFIER NOT NULL -> Users(Id)
CreatedAt        DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
PRIMARY KEY (CommentId, MentionedUserId)
```
Records parsed mentions → idempotent mention notifications + audit.

**`Notifications` — add columns:**
```
SavedForLater  BIT       NOT NULL DEFAULT 0
SavedAt        DATETIME2 NULL
```
`Type` (existing free-text/enum) gains values: `MENTION`, `COMMENT_ASSIGNED`. `COMMENT_ADDED` now also fans to watchers.

**Presence — NO table.** Ephemeral in Redis: key `presence:task:{taskId}:{userId}`, TTL ≈ 30s, value `{ lastSeen, typing }`. Avoids DB write churn; disconnect handled by TTL expiry.

**Indexes:** `Comments(AssignedToId)` (inbox-by-assignee); `Notifications(UserId, SavedForLater)`; `CommentMentions(MentionedUserId)`.

---

## 4. Slice 3.5a — Notification depth (backend + minimal UI)

### 4.1 Mention parsing
- Composer inserts **structured tokens** `@[Display Name](userId)`. Backend regex extracts `userId`s in `comment.service.ts` on create AND update (diff so edits don't re-notify already-mentioned users).
- For each extracted userId: **validate it is a member of the comment's workspace** (reject/skip non-members — tenant safety). Insert into `CommentMentions` (idempotent). For genuinely new mentions: create `MENTION` notification + auto-watch the user.

### 4.2 Auto-watch (idempotent `usp_TaskWatcher_Add`)
- On assignment (`task.service.ts` assignment path): each new assignee.
- On mention: each newly mentioned user.
- On commenting: the comment author auto-watches the task (ClickUp behavior).

### 4.3 Watchers in fan-out
- New helper `fanOutTaskEvent(taskId, actorId, type, payload)`: recipients = `union(reporter, assignees, watchers) − actor`, deduped; then `notificationService.notify(...)`.
- Used for `COMMENT_ADDED` and `TASK_UPDATED`. `TASK_ASSIGNED` stays targeted to new assignees only.
- Backfills the `TASK_UPDATED` type, which today is a frontend label with no producer (wire it on meaningful task transitions — status/assignee/due change — debounced to avoid spam).

### 4.4 Assigned / resolved comments
- SPs `usp_Comment_Assign(@CommentId,@AssigneeId,@ActorId)`, `usp_Comment_Resolve(@CommentId,@ActorId,@Resolved)`.
- GraphQL mutations `assignComment(commentId, assigneeId)`, `resolveComment(commentId, resolved)`.
- Assigning creates a `COMMENT_ASSIGNED` notification to the assignee + auto-watch + surfaces in their Inbox.
- Object-level authz: assign/resolve require EDIT on the task's list (or comment author).

### 4.5 Minimal UI (no realtime yet)
- Mention `@` autocomplete in `CommentSection.tsx` composer; render tokens as chips in display.
- Assign button + assignee avatar on a comment; resolve toggle (resolved → collapse/grey).

---

## 5. Slice 3.5b — Realtime client (Apollo Client + SSE)

### 5.1 Backend
- New subscription `notificationAdded(userId): Notification`, published from `notificationService.notify` to channel `notification:{userId}`.
- **Authz:** the subscribe resolver ignores any client-supplied userId mismatch — it binds to the authenticated user's id from context. A user can only receive their own notifications.
- Reuse existing `taskUpdated(projectId)`, `commentAdded(taskId)`.

### 5.2 Frontend
- Add `@apollo/client` + `graphql-sse` link. A **client-only `ApolloProvider`** mounted high in the app tree (a client component), used ONLY for subscriptions + a small number of live queries. SSR data fetching (server actions/REST) is unchanged — Apollo's cache is NOT the app's data layer.
- Wiring:
  - Notification bell badge subscribes to `notificationAdded` → increments unread + prepends item.
  - Task-detail comment list subscribes to `commentAdded` → appends new comments.
  - Board/list `taskUpdated` subscription is **deferred** (keep slice scope tight).
- **Single source of truth:** the SSR-rendered list is the base; Apollo applies live deltas on top. No dual data source — live deltas mutate local component state / a scoped cache, never a parallel full fetch.

---

## 6. Slice 3.5c — Inbox + Presence

### 6.1 Inbox
- Replace the hardcoded `notifications-view.tsx` mockup (Item1–Item20) with real data from the notifications API.
- Filters/tabs: **All / Unread / Assigned / Mentions / Comments / Saved-for-later**. (by-type filtering pushes a `type IN (...)` / `savedForLater=1` predicate to `usp_Notification_List` — extend the SP + repository.)
- Actions: mark-read, **save-for-later toggle** (new mutation `setNotificationSaved(id, saved)`), mark-all-read.
- Assigned comments surface as Inbox items via the `COMMENT_ASSIGNED` type.
- Live updates via the `notificationAdded` subscription from 3.5b.

### 6.2 Presence
- **Backend:** mutation `presenceHeartbeat(taskId, typing: Boolean): [PresenceUser]` — writes the Redis key with TTL and publishes `presenceUpdated:{taskId}` with the current viewer set `{ userId, name, avatarUrl, typing, lastSeen }`. Authz: requires VIEW on the task's list. Subscription `presenceUpdated(taskId): [PresenceUser]` emits the current snapshot on subscribe. Optional `presenceLeave(taskId)` on unmount/`visibilitychange`; otherwise TTL expiry cleans up.
- **Frontend:** task-detail header shows viewer avatars ("3 viewing"); the comment composer shows a typing indicator. Client sends a heartbeat every ~20s (and on typing start/stop) via an Apollo mutation while the task detail is open; stops on close.

---

## 7. Testing

- **Integration** (Docker MSSQL `ProjectFlow_Test` @localhost:1433 + Redis localhost:6379):
  - mention → `CommentMentions` row + `MENTION` notification + watcher row; edit does not re-notify.
  - auto-watch on assign / on comment.
  - `fanOutTaskEvent` recipient union + dedup + actor-exclusion; `COMMENT_ADDED` reaches watchers.
  - assign/resolve comment SPs; save-for-later; inbox by-type filter predicate.
  - **Tenant isolation:** mention of a non-workspace-member rejected; notification/presence authz (can't read another user's notifications; presence requires VIEW).
- **Unit:** mention-token extraction (incl. malformed tokens, duplicates), fan-out union/dedup, Apollo delta reconciliation logic.
- **e2e** (Playwright): mention → recipient sees notification; inbox filter + save-for-later round-trip; **two-context presence** (second viewer avatar appears, typing indicator toggles). Realtime e2e needs explicit waits on subscription delivery.

---

## 8. Cross-cutting (apply throughout)

- Tenant isolation (`WorkspaceId`) on every new SP/query.
- Subscription authz from auth context, never from client args (`notificationAdded` = own user; `presenceUpdated`/`presenceHeartbeat` = VIEW on list).
- Idempotent mention/watch inserts.
- i18n (EN + ID) for all new UI strings.
- Record SP-per-op exceptions + deviations in `DECISIONS.md`.

---

## 9. Out of scope (YAGNI / deferred)

- Per-type notification **mute/preferences** settings.
- Presence on **board/list** surfaces (task-detail viewers only in v1).
- Comment **threading UI** (DB `ParentId` exists; surfacing nested replies is its own effort).
- **Email/push** delivery of notifications (in-app only).
- Board/list `taskUpdated` live subscription (deferred within 3.5b).

---

## 10. Risks

- **Apollo-in-SSR-app drift:** mixing Apollo subscriptions with the server-action data layer risks dual sources of truth. Mitigation: Apollo is delta-only; SSR data is the base.
- **Presence cost/correctness:** heartbeat fan-out + TTL semantics across multiple API instances rely on Redis pubsub (already in place for pubsub). Verify multi-instance behavior.
- **Notification spam:** `TASK_UPDATED` fan-out to watchers can be noisy. Mitigation: debounce + only meaningful transitions.
- **Mention encoding migration:** existing comments have no structured tokens; mentions only apply to new/edited comments (acceptable — no backfill).
