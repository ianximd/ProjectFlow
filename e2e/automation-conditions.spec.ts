/**
 * E2E: Phase 6b — Condition engine (§5.5 acceptance)
 *
 * Proves the recursive condition tree is evaluated by the REAL stack
 * (API + BullMQ worker + Redis + local test DB) on a single STATUS_CHANGED
 * transition, by registering TWO PROJECT-scoped rules on the SAME task whose
 * top-level OR groups differ only in whether a branch matches the event:
 *
 *   1. API seeds user + workspace + project + list + task (reporter = the user).
 *   2. Rule A — trigger STATUS_CHANGED→"Done"; conditions = an OR group whose
 *      SECOND branch (status is "Done") matches the event payload (the
 *      STATUS_CHANGED event carries status = toStatus = "Done"); action
 *      ASSIGN→"REPORTER".  Expected: the OR group is satisfied → rule FIRES.
 *   3. Rule B — same trigger; conditions = an OR group where NEITHER branch
 *      matches (priority is HIGH — the task isn't; status is "Blocked" — the
 *      event is "Done").  Expected: the OR group is NOT satisfied → rule SKIPS.
 *   4. API transitions the task to "Done" ONCE → emitAutomationEvent(
 *      'STATUS_CHANGED') → getByTrigger resolves BOTH rules → two BullMQ jobs →
 *      the worker evaluates each rule's condition tree.
 *   5. Poll each rule's GET /automations/:id/runs independently:
 *        • Rule A records a STATUS_CHANGED run with status 'success'
 *          (OR group matched → ASSIGN ran).
 *        • Rule B records a STATUS_CHANGED run with status 'skipped'
 *          (OR group excluded → action did NOT run).
 *   6. Confirm the reporter is now an assignee (Rule A's ASSIGN effect landed).
 *
 * Why API-driven (not the builder UI):
 *   The Critical seam this slice adds is the recursive condition EVALUATION in
 *   the worker, not the builder UI (the tree builder is covered by web unit
 *   tests). Recorded runs are the most direct, race-free regression guard: if
 *   the OR-group evaluation were wrong, Rule A would skip (no ASSIGN) or Rule B
 *   would fire — and the polled run statuses below would not be success/skipped
 *   as asserted. Proving BOTH outcomes on a SINGLE transition shows the engine
 *   includes the matching branch and excludes the non-matching one.
 *
 * Operational notes
 * ─────────────────
 * 1. Requires a running BullMQ worker + Redis + local test DB (NOT prod).
 * 2. Actions/skip decisions run inside the BullMQ worker asynchronously; step 5
 *    polls the run history with auto-retrying expect (no fixed sleeps).
 * 3. Run ONLY with explicit local DB env (DB_SERVER=localhost …
 *    DB_NAME=ProjectFlow_Test) so it never touches prod. See e2e/README.md.
 */

import { test, expect, request as playwrightRequest } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';

function uniqSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

test.describe('Phase 6b — condition engine', () => {
  test('an OR-group rule fires for a matching branch and skips when neither matches', async () => {
    const suffix      = uniqSuffix();
    const password    = 'E2EPass123!';
    const email       = `cond-${suffix}@projectflow.test`;
    const name        = `Cond User ${suffix}`;
    const taskTitle   = `Cond task ${suffix}`;
    const ruleNameA   = `Fire on Done OR ${suffix}`;
    const ruleNameB   = `Skip when neither ${suffix}`;

    const api = await playwrightRequest.newContext();

    // ── 1. Register + login (API) ─────────────────────────────────────────────
    expect(
      (await api.post(`${API_BASE}/auth/register`, { data: { email, name, password } })).status(),
      'register',
    ).toBe(201);

    const loginRes = await api.post(`${API_BASE}/auth/login`, { data: { email, password } });
    expect(loginRes.status(), 'login').toBe(200);
    const { data: { token } } = await loginRes.json();
    const headers = { Authorization: `Bearer ${token}` };

    // Resolve the user's own id (the task reporter; ASSIGN→REPORTER resolves to it).
    const meRes = await api.get(`${API_BASE}/auth/me`, { headers });
    expect(meRes.status(), '/auth/me').toBe(200);
    const meBody = (await meRes.json()).data;
    const userId: string = meBody.Id ?? meBody.id;
    expect(userId, 'userId resolved').toBeTruthy();

    // ── 2. Workspace → project (Space) → list → task ──────────────────────────
    const ws = (await (await api.post(`${API_BASE}/workspaces`, {
      headers, data: { name: `Cond WS ${suffix}`, slug: `cond-ws-${suffix}` },
    })).json()).data;
    const workspaceId: string = ws.Id ?? ws.id;
    expect(workspaceId, 'workspaceId').toBeTruthy();

    const project = (await (await api.post(`${API_BASE}/projects`, {
      headers,
      data: {
        workspaceId,
        name: `Cond Project ${suffix}`,
        key:  `CO${suffix.slice(-4).toUpperCase()}`,
        type: 'KANBAN',
      },
    })).json()).data;
    const projectId: string = project.Id ?? project.id;
    expect(projectId, 'projectId').toBeTruthy();

    // A list is required so the task has a full hierarchy path and the
    // automation ASSIGN action resolves membership (VIEW authz on the list).
    const list = (await (await api.post(`${API_BASE}/lists`, {
      headers,
      data: { workspaceId, spaceId: projectId, folderId: null, name: 'Default', position: 0 },
    })).json()).data;
    const listId: string = list.id ?? list.Id;
    expect(listId, 'listId').toBeTruthy();

    const taskRes = await api.post(`${API_BASE}/tasks`, {
      headers,
      data: { workspaceId, listId, title: taskTitle },
    });
    expect(taskRes.status(), 'create task').toBe(201);
    const taskBody = (await taskRes.json()).data;
    const taskId: string = String(taskBody.Id ?? taskBody.id);
    expect(taskId, 'taskId').toBeTruthy();

    // ── 3a. Rule A — OR group where the SECOND branch MATCHES the event ────────
    // The STATUS_CHANGED payload carries status = toStatus = "Done", so the OR's
    // second branch (status is "Done") matches → the group is satisfied → fires.
    const ruleARes = await api.post(`${API_BASE}/automations`, {
      headers,
      data: {
        scopeType:  'PROJECT',
        workspaceId,
        projectId,
        name:       ruleNameA,
        trigger:    { type: 'STATUS_CHANGED', toStatus: 'Done' },
        conditions: {
          op: 'OR',
          children: [
            // task is NOT HIGH priority → no match
            { type: 'FIELD_EQUALS', field: 'priority', operator: 'is', value: 'HIGH' },
            // event status = "Done" → MATCHES → OR group satisfied
            { type: 'FIELD_EQUALS', field: 'status', operator: 'is', value: 'Done' },
          ],
        },
        actions: [{ type: 'ASSIGN', assigneeId: 'REPORTER' }],
      },
    });
    expect(ruleARes.status(), 'create rule A').toBe(201);
    const ruleAId: string = String((await ruleARes.json()).rule.id);
    expect(ruleAId, 'ruleAId').toBeTruthy();

    // ── 3b. Rule B — OR group where NEITHER branch matches ────────────────────
    // priority is HIGH (task isn't) and status is "Blocked" (event is "Done"),
    // so NEITHER branch matches → the OR group is NOT satisfied → skips.
    const ruleBRes = await api.post(`${API_BASE}/automations`, {
      headers,
      data: {
        scopeType:  'PROJECT',
        workspaceId,
        projectId,
        name:       ruleNameB,
        trigger:    { type: 'STATUS_CHANGED', toStatus: 'Done' },
        conditions: {
          op: 'OR',
          children: [
            // task is NOT HIGH priority → no match
            { type: 'FIELD_EQUALS', field: 'priority', operator: 'is', value: 'HIGH' },
            // event status = "Done", not "Blocked" → no match
            { type: 'FIELD_EQUALS', field: 'status', operator: 'is', value: 'Blocked' },
          ],
        },
        actions: [{ type: 'ASSIGN', assigneeId: 'REPORTER' }],
      },
    });
    expect(ruleBRes.status(), 'create rule B').toBe(201);
    const ruleBId: string = String((await ruleBRes.json()).rule.id);
    expect(ruleBId, 'ruleBId').toBeTruthy();

    // ── 4. Transition the task to Done ONCE (fires the engine for BOTH rules) ──
    // PATCH /tasks/:id/transition → emitAutomationEvent('STATUS_CHANGED') →
    // getByTrigger resolves BOTH rules → two BullMQ jobs → the worker evaluates
    // each rule's recursive OR-group condition tree.
    const transRes = await api.patch(`${API_BASE}/tasks/${taskId}/transition`, {
      headers, data: { status: 'Done' },
    });
    expect(transRes.status(), 'transition to Done').toBe(200);

    // ── 5a. Rule A: poll until a SUCCESS run is recorded (OR group matched) ────
    // A 'success' run proves the matching branch satisfied the OR group and the
    // ASSIGN action ran. If the engine wrongly excluded the matching branch,
    // Rule A would skip (or never record) and this poll would time out.
    await expect(async () => {
      const runsRes = await api.get(`${API_BASE}/automations/${ruleAId}/runs`, { headers });
      expect(runsRes.status(), 'list runs A').toBe(200);
      const runs: Array<{ status: string; triggerType: string }> = (await runsRes.json()).runs;
      const statusRun = runs.find((r) => r.triggerType === 'STATUS_CHANGED');
      expect(statusRun, 'rule A: a STATUS_CHANGED run was recorded (engine fired)').toBeTruthy();
      expect(statusRun!.status, 'rule A run status').toBe('success');
    }).toPass({ timeout: 20_000, intervals: [500, 1000, 1500, 2000, 3000] });

    // ── 5b. Rule B: poll until a SKIPPED run is recorded (OR group excluded) ───
    // A 'skipped' run proves the engine evaluated the tree and found NEITHER
    // branch matched, so the action did NOT run. If the engine wrongly included
    // a non-matching branch, Rule B would be 'success' and this would fail.
    await expect(async () => {
      const runsRes = await api.get(`${API_BASE}/automations/${ruleBId}/runs`, { headers });
      expect(runsRes.status(), 'list runs B').toBe(200);
      const runs: Array<{ status: string; triggerType: string }> = (await runsRes.json()).runs;
      const statusRun = runs.find((r) => r.triggerType === 'STATUS_CHANGED');
      expect(statusRun, 'rule B: a STATUS_CHANGED run was recorded (engine evaluated)').toBeTruthy();
      expect(statusRun!.status, 'rule B run status').toBe('skipped');
    }).toPass({ timeout: 20_000, intervals: [500, 1000, 1500, 2000, 3000] });

    // ── 6. Confirm the reporter is now assigned (Rule A's ASSIGN effect landed) ─
    const listRes = await api.get(`${API_BASE}/tasks?projectId=${projectId}`, { headers });
    expect(listRes.status(), 'list tasks').toBe(200);
    const listJson = await listRes.json();
    const assignees: Array<{ UserId?: string; userId?: string }> =
      listJson.meta?.assigneesByTaskId?.[taskId] ?? [];
    const assigneeIds = assignees.map((a) => a.UserId ?? a.userId);
    expect(assigneeIds, 'reporter assigned by rule A ASSIGN action').toContain(userId);

    // ── 7. Cleanup ─────────────────────────────────────────────────────────────
    const wsDel = await api.delete(`${API_BASE}/workspaces/${workspaceId}`, { headers });
    expect([204, 404], 'workspace cleanup').toContain(wsDel.status());
    await api.dispose();
  });
});
