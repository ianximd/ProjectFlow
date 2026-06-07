/**
 * E2E: Phase 6a — Automation engine activation (Task 13)
 *
 * Proves the STATUS_CHANGED → ASSIGN rule fires end-to-end against the REAL
 * stack (API + BullMQ worker + Redis + local test DB):
 *   1. API seeds user + workspace + project + list + task (reporter = the user).
 *   2. API creates a PROJECT-scoped rule: Trigger STATUS_CHANGED→"Done",
 *      Action ASSIGN→"REPORTER".
 *   3. API transitions the task to "Done" → emitAutomationEvent('STATUS_CHANGED')
 *      → getByTrigger resolves the rule → BullMQ job → worker runs ASSIGN.
 *   4. Poll GET /automations/:id/runs until the engine records a run with
 *      status 'success'.
 *   5. Confirm the reporter is now an assignee (the ASSIGN effect landed).
 *
 * Why API-driven (not the builder UI):
 *   The Critical seam this slice had to get right is the ENGINE path, not the
 *   builder UI (the builder + scope selector are covered by web unit tests). A
 *   recorded run is the most direct, race-free regression guard: if the scope
 *   ids emitted from transitionTask were mis-cased (the bug this slice fixed),
 *   getByTrigger would match zero rules, NO run would ever be recorded, and the
 *   poll in step 4 would time out. A 'success' status additionally proves the
 *   ASSIGN action executed without error (the setAssignees fix).
 *
 * Operational notes
 * ─────────────────
 * 1. Requires a running BullMQ worker + Redis + local test DB (NOT prod).
 * 2. The ASSIGN action runs inside the BullMQ worker asynchronously; step 4
 *    polls the run history with auto-retrying expect (no fixed sleeps).
 * 3. Run ONLY with explicit local DB env (DB_SERVER=localhost …
 *    DB_NAME=ProjectFlow_Test) so it never touches prod. See e2e/README.md.
 */

import { test, expect, request as playwrightRequest } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';

function uniqSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

test.describe('Phase 6a — automation engine activation', () => {
  test('a STATUS_CHANGED → ASSIGN rule fires when a task moves to Done', async () => {
    const suffix    = uniqSuffix();
    const password  = 'E2EPass123!';
    const email     = `auto-${suffix}@projectflow.test`;
    const name      = `Auto User ${suffix}`;
    const taskTitle = `Auto task ${suffix}`;
    const ruleName  = `Assign on Done ${suffix}`;

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
      headers, data: { name: `Auto WS ${suffix}`, slug: `auto-ws-${suffix}` },
    })).json()).data;
    const workspaceId: string = ws.Id ?? ws.id;
    expect(workspaceId, 'workspaceId').toBeTruthy();

    const project = (await (await api.post(`${API_BASE}/projects`, {
      headers,
      data: {
        workspaceId,
        name: `Auto Project ${suffix}`,
        key:  `AU${suffix.slice(-4).toUpperCase()}`,
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

    // ── 3. Create the STATUS_CHANGED → ASSIGN rule via the API ────────────────
    const ruleRes = await api.post(`${API_BASE}/automations`, {
      headers,
      data: {
        scopeType:  'PROJECT',
        workspaceId,
        projectId,
        name:       ruleName,
        trigger:    { type: 'STATUS_CHANGED', toStatus: 'Done' },
        conditions: [],
        actions:    [{ type: 'ASSIGN', assigneeId: 'REPORTER' }],
      },
    });
    expect(ruleRes.status(), 'create automation rule').toBe(201);
    const ruleId: string = String((await ruleRes.json()).rule.id);
    expect(ruleId, 'ruleId').toBeTruthy();

    // ── 4. Transition the task to Done (fires the engine) ─────────────────────
    // PATCH /tasks/:id/transition → emitAutomationEvent('STATUS_CHANGED') →
    // getByTrigger resolves the rule (scope ids MUST be correctly cased!) →
    // BullMQ job → worker executes ASSIGN(REPORTER) via usp_Task_SetAssignees.
    const transRes = await api.patch(`${API_BASE}/tasks/${taskId}/transition`, {
      headers, data: { status: 'Done' },
    });
    expect(transRes.status(), 'transition to Done').toBe(200);

    // ── 5. Poll the run history until the engine records a SUCCESS run ────────
    // The worker is async (BullMQ). A recorded run proves the rule MATCHED
    // (getByTrigger saw correctly-cased scope ids — the casing-bug regression
    // guard); status 'success' proves the ASSIGN action ran without error (the
    // setAssignees fix). If the casing bug returned, zero rules would match, no
    // run would be recorded, and this poll would time out.
    await expect(async () => {
      const runsRes = await api.get(`${API_BASE}/automations/${ruleId}/runs`, { headers });
      expect(runsRes.status(), 'list runs').toBe(200);
      const runs: Array<{ status: string; triggerType: string }> = (await runsRes.json()).runs;
      const statusRun = runs.find((r) => r.triggerType === 'STATUS_CHANGED');
      expect(statusRun, 'a STATUS_CHANGED run was recorded (engine fired)').toBeTruthy();
      expect(statusRun!.status, 'run status').toBe('success');
    }).toPass({ timeout: 20_000, intervals: [500, 1000, 1500, 2000, 3000] });

    // ── 6. Confirm the reporter is now assigned (the ASSIGN effect landed) ────
    const listRes = await api.get(`${API_BASE}/tasks?projectId=${projectId}`, { headers });
    expect(listRes.status(), 'list tasks').toBe(200);
    const listJson = await listRes.json();
    const assignees: Array<{ UserId?: string; userId?: string }> =
      listJson.meta?.assigneesByTaskId?.[taskId] ?? [];
    const assigneeIds = assignees.map((a) => a.UserId ?? a.userId);
    expect(assigneeIds, 'reporter assigned by ASSIGN action').toContain(userId);

    // ── 7. Cleanup ─────────────────────────────────────────────────────────────
    const wsDel = await api.delete(`${API_BASE}/workspaces/${workspaceId}`, { headers });
    expect([204, 404], 'workspace cleanup').toContain(wsDel.status());
    await api.dispose();
  });
});
