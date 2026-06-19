# Phase 11d — AI Stand-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scheduled BullMQ worker (twin of `scheduled-report.worker`) that, per opted-in user, pulls **their own VIEW-able** recent activity + open/blocked tasks → `gateway.complete` → delivers an `AI_STANDUP` inbox notification. Plus on-demand `GET /ai/standup`.

**Architecture:** Reuse Phase-9e `usp_AuditLog_List` (already permission-post-filtered by `activity.service`) for "what the user did/saw", plus their open/blocked tasks; compose a prompt; `gateway.complete`; deliver via the existing notification service. A stand-up only ever summarizes what that user can see — no cross-user data.

**Tech Stack:** As 11a. BullMQ scheduled worker, notifications module, `activity.service`.

**Spec:** `docs/superpowers/specs/2026-06-18-ai-layer-phase11-design.md` §6 "11d", §7. **Depends on 11a (gateway).**

---

### Task 0: Reconciliation (FIRST)

- [ ] Confirm `scheduled-report.worker.ts` pattern: Queue + Worker + `upsertJobScheduler('...-every-5m', { every }, ...)` + an exported testable `runScheduledReportSweep()` + a dev `/dev/scheduled-reports/sweep` route. The stand-up worker mirrors this exactly.
- [ ] Confirm `activity.service.ts` `listScoped`/equivalent calls `usp_AuditLog_List` and **post-filters by `accessService.can(userId, nodeType, resourceId, 'VIEW')`** — reuse it so stand-up activity is already permission-safe.
- [ ] Confirm the notification service `notify({ recipientIds, actorId, type, payload })` and how a new `type` (`AI_STANDUP`) is added (the notification type enum/CHECK + inbox rendering).
- [ ] Confirm how a per-user "opted-in" preference is stored (user/workspace settings table) or decide to default opt-in OFF with a simple preference row.

---

## File Structure

```
apps/api/src/modules/ai/standup/
  standup.service.ts            # gather VIEW-able activity + blockers → complete → text
  standup.worker.ts             # scheduled twin of scheduled-report.worker; startStandupWorker()
  standup.dev.routes.ts         # POST /dev/ai/standup-sweep (NODE_ENV guard)
apps/api/src/modules/ai/ai.routes.ts        # +GET /ai/standup (on-demand)
apps/api/src/server.ts                      # start worker + mount dev route
infra/sql/migrations/0066_ai_standup_prefs.sql   # opt-in preference (if no existing table fits)
infra/sql/migrations/rollback/0066_ai_standup_prefs.down.sql
apps/api/src/modules/notifications/...       # +AI_STANDUP type
apps/api/src/modules/ai/__tests__/standup.integration.test.ts
apps/api/src/modules/ai/__tests__/standup.security.integration.test.ts
apps/next-web/src/components/...             # inbox renders AI_STANDUP
apps/next-web/messages/en.json / id.json     # +Ai.standup.* (parity)
```

---

### Task 1: Opt-in preference + `AI_STANDUP` notification type

**Files:** Create `0066_ai_standup_prefs.sql` (+rollback) if needed; Modify notification type enum.

- [ ] **Step 1:** If no existing per-user preference table fits, add a minimal `AiStandupPrefs(UserId, WorkspaceId, Enabled BIT, Cadence NVARCHAR(10) DEFAULT 'daily', CreatedAt)` migration (idempotent, mirror `0062`). Otherwise add an `Enabled` flag to the existing prefs table.
- [ ] **Step 2:** Add `AI_STANDUP` to the notification type enum/CHECK + inbox payload shape `{ standupText, periodStart, periodEnd }`.
- [ ] **Step 3: Run migration on local Docker — applied. Step 4: Commit.** `feat(11d): AI_STANDUP notification type + opt-in prefs`

---

### Task 2: `standup.service.ts` — gather (VIEW-safe) + complete

**Files:** Create `standup.service.ts`; Test `__tests__/standup.integration.test.ts`

- [ ] **Step 1: Failing test** — seed a user with recent activity + an open/blocked assigned task; `buildStandup(userId, workspaceId)` returns `{ text }` referencing only that user's visible items.
- [ ] **Step 2: Implement:**

```ts
async buildStandup(userId: string, workspaceId: string, since?: Date) {
  const from = since ?? new Date(Date.now() - 24 * 3600_000);
  // activity.service already post-filters by accessService.can → VIEW-safe
  const activity = await activityService.listScoped({ workspaceId, userId, fromDate: from, page: 1, pageSize: 50 });
  const blockers = await taskService.listOpenBlockedForUser(userId, workspaceId); // assignee + open/blocked
  const prompt = buildStandupPrompt(activity.entries, blockers);
  const { text } = await aiGatewayService.complete({ workspaceId, userId, feature: 'standup' }, { prompt });
  return { text, periodStart: from.toISOString(), periodEnd: new Date().toISOString() };
}
```

If `taskService.listOpenBlockedForUser` doesn't exist, add it (assignee = user, status open/blocked); the user's own assigned tasks are inherently VIEW-able, but assert it in the test.

- [ ] **Step 3: Run — PASS. Step 4: Commit.** `feat(11d): StandupService — VIEW-safe activity+blockers → complete`

---

### Task 3: Security test (no cross-user / cross-tenant leak)

**Files:** Test `__tests__/standup.security.integration.test.ts`

- [ ] **Step 1: Write** — seed user A with activity in a private space user B can't see, plus a second tenant; build B's stand-up; assert B's text references NONE of A's private items nor the other tenant's data (FakeProvider echoes → assert ids absent). Also assert A's stand-up doesn't pull another user's activity rows.
- [ ] **Step 2: Run — PASS. Step 3: Commit.** `test(11d): stand-up summarizes only the user's own VIEW-able data`

---

### Task 4: Scheduled worker + on-demand endpoint + dev sweep

**Files:** Create `standup.worker.ts`, `standup.dev.routes.ts`; Modify `ai.routes.ts`, `server.ts`

- [ ] **Step 1: Implement `standup.worker.ts`** mirroring `scheduled-report.worker.ts`: Queue + Worker + `upsertJobScheduler('ai-standup-sweep', { every: <interval> }, ...)`; export `startStandupWorker()` + a testable `runStandupSweep()` that iterates opted-in users, checks cadence (reuse the scheduled-report cron-window helper), `buildStandup`, and `notificationService.notify({ recipientIds:[userId], type:'AI_STANDUP', payload })`. ponytail: interval sweep + per-user cadence check, not per-user repeatable jobs.
- [ ] **Step 2: Add `GET /ai/standup`** to `ai.routes.ts` (`requirePermission('ai.use', ...)`, `resolveWorkspace` from query) → `buildStandup(userId, workspaceId)`.
- [ ] **Step 3: Add `standup.dev.routes.ts`** `POST /dev/ai/standup-sweep` (NODE_ENV guard) calling `runStandupSweep()` for deterministic e2e.
- [ ] **Step 4: Wire `server.ts`** — `startStandupWorker()` in the REDIS block; mount dev route under `/dev`.
- [ ] **Step 5: Test** the on-demand endpoint + a direct `runStandupSweep()` delivering an inbox notification. Run — PASS. **Step 6: Commit.** `feat(11d): scheduled stand-up worker + GET /ai/standup + dev sweep`

---

### Task 5: Frontend inbox surface + i18n

**Files:** Modify inbox/notification renderer; Modify `messages/en.json`, `id.json`

- [ ] **Step 1:** Render `AI_STANDUP` notifications in the inbox (title + stand-up text + period). Add `Ai.standup.*` keys to en + id (parity).
- [ ] **Step 2: Web unit test** the renderer. Run — PASS. **Step 3: Commit.** `feat(11d): inbox AI_STANDUP rendering + en/id i18n`

---

### Task 6: e2e + DoD

- [ ] **Step 1: Playwright** — opt a user in; seed activity; trigger `/dev/ai/standup-sweep`; assert an `AI_STANDUP` appears in their inbox; on-demand `GET /ai/standup` returns text.
- [ ] **Step 2:** tsc (api) + Next build clean; full `npx vitest run apps/api/src/modules/ai` green; en/id parity.
- [ ] **Step 3:** DECISIONS.md entry (stand-up reuses `usp_AuditLog_List` permission-scoped activity; interval-sweep + cadence; opt-in).
- [ ] **Step 4: Final opus whole-slice review** (do NOT skip) — focus that NO cross-user/cross-tenant data enters the prompt.
- [ ] **Step 5: ff-merge to main locally, STOP for review** before 11e.

---

## Self-Review Notes
- The activity source (`activity.service.listScoped`) is already `can()`-post-filtered (Phase 9e) — stand-up inherits that, no parallel ACL.
- Cadence is interval-sweep + per-user check, matching scheduled-reports; per-user repeatable jobs deferred (not needed at this scale).
