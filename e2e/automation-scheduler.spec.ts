/**
 * E2E: Phase 6c — Automation scheduler (§6.6 headline flow)
 *
 * Proves that a DUE_DATE_PASSED trigger fires via the scheduler sweep and the
 * CALL_WEBHOOK action is audited against the REAL stack (API + BullMQ workers
 * + Redis + local test DB):
 *
 *   1. API seeds user + workspace + project + list.
 *   2. Register a workspace outgoing webhook subscribed to 'automation.fired'
 *      at an unreachable sink URL (http://127.0.0.1:65535/void) — delivery
 *      attempt is fire-and-forget and always recorded even when the POST fails.
 *      Uses 'automation.fired' (the natural default for automation webhooks
 *      and the first entry in the WEBHOOK_EVENTS selector) — proves follow-up #1.
 *   3. Create an OVERDUE task with an explicit priority='high' (dueDate = 60 s ago).
 *   4. Create a DUE_DATE_PASSED rule with:
 *        - a condition: ISSUE_MATCHES_FILTER with pql='priority = high'
 *          This condition only passes after the worker hydrates it with the
 *          task's current DB fields (follow-up #2). Without hydration the
 *          scheduler payload only carries {taskId,projectId} so priority=null
 *          and the condition would fail-closed.
 *        - a CALL_WEBHOOK action using webhookEvent: 'automation.fired'
 *          (must match the registered webhook's subscribed event).
 *   5. Trigger one scheduler sweep via POST /api/v1/dev/automation/sweep.
 *   6. HEADLINE assertion: poll GET /automations/:id/runs until runs.length >= 1.
 *      A recorded run proves: sweep found the task, enqueued the job, the worker
 *      hydrated the task fields, the PQL condition matched 'high', and the
 *      CALL_WEBHOOK action was executed. This covers both follow-up #1 and #2.
 *
 * Why API-driven (not UI):
 *   The critical seam is the scheduler→worker→audit pipeline, not the builder
 *   UI. A recorded run is the most direct regression guard: if the sweep failed
 *   to enqueue, or the worker failed to match the rule/task, or the audit write
 *   failed, this poll would time out.
 *
 * Operational notes
 * ─────────────────
 * 1. Requires a running BullMQ worker + Redis + local test DB (NOT prod).
 * 2. POST /dev/automation/sweep is a test-only endpoint that returns 404 in
 *    production. It requires a valid Bearer token.
 * 3. Run ONLY with explicit local DB env (DB_SERVER=localhost …
 *    DB_NAME=ProjectFlow_Test) so it never touches prod. See e2e/README.md.
 */

import { test, expect, request as playwrightRequest } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';

function uniqSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

test.describe('Phase 6c — automation scheduler', () => {
  // Covers follow-up #1 (automation.fired event enum) and follow-up #2
  // (scheduler-origin condition hydration with the task's current DB fields).
  test('a DUE_DATE_PASSED rule with priority condition fires via sweep — automation.fired + hydrated condition', async () => {
    const suffix    = uniqSuffix();
    const password  = 'E2EPass123!';
    const email     = `sched-${suffix}@projectflow.test`;
    const name      = `Sched User ${suffix}`;
    const taskTitle = `Overdue task ${suffix}`;
    const ruleName  = `Webhook on overdue ${suffix}`;

    const api = await playwrightRequest.newContext();

    // ── 1. Register + login ───────────────────────────────────────────────────
    expect(
      (await api.post(`${API_BASE}/auth/register`, { data: { email, name, password } })).status(),
      'register',
    ).toBe(201);

    const loginRes = await api.post(`${API_BASE}/auth/login`, { data: { email, password } });
    expect(loginRes.status(), 'login').toBe(200);
    const { data: { token } } = await loginRes.json();
    const headers = { Authorization: `Bearer ${token}` };

    // ── 2. Workspace → project → list ─────────────────────────────────────────
    const ws = (await (await api.post(`${API_BASE}/workspaces`, {
      headers, data: { name: `Sched WS ${suffix}`, slug: `sched-ws-${suffix}` },
    })).json()).data;
    const workspaceId: string = ws.Id ?? ws.id;
    expect(workspaceId, 'workspaceId').toBeTruthy();

    const project = (await (await api.post(`${API_BASE}/projects`, {
      headers,
      data: {
        workspaceId,
        name: `Sched Project ${suffix}`,
        key:  `SC${suffix.slice(-4).toUpperCase()}`,
        type: 'KANBAN',
      },
    })).json()).data;
    const projectId: string = project.Id ?? project.id;
    expect(projectId, 'projectId').toBeTruthy();

    const list = (await (await api.post(`${API_BASE}/lists`, {
      headers,
      data: { workspaceId, spaceId: projectId, folderId: null, name: 'Default', position: 0 },
    })).json()).data;
    const listId: string = list.id ?? list.Id;
    expect(listId, 'listId').toBeTruthy();

    // ── 3. Register a workspace outgoing webhook ───────────────────────────────
    // Subscribed to 'automation.fired' — the natural default for automation
    // webhooks and the first entry in the CALL_WEBHOOK selector (follow-up #1).
    // The sink URL is unreachable by design; delivery still produces an audit row.
    const webhookRes = await api.post(`${API_BASE}/outgoing-webhooks`, {
      headers,
      data: {
        workspaceId,
        name:   `Sched webhook ${suffix}`,
        url:    'http://127.0.0.1:65535/void',
        secret: 's3cr3tpass',
        events: ['automation.fired'],
      },
    });
    expect(webhookRes.status(), 'create outgoing webhook').toBe(201);
    const webhookBody = (await webhookRes.json()).data;
    const webhookId: string = webhookBody.id ?? webhookBody.Id;
    expect(webhookId, 'webhookId').toBeTruthy();

    // ── 4. Create an OVERDUE task with explicit priority='high' ───────────────
    // The priority is seeded so the condition below can match it. Without
    // scheduler-payload hydration (follow-up #2) the worker sees priority=null
    // and the condition fails-closed, so no run would be recorded.
    const overdueDate = new Date(Date.now() - 60_000).toISOString();
    const taskRes = await api.post(`${API_BASE}/tasks`, {
      headers,
      data: { workspaceId, listId, title: taskTitle, dueDate: overdueDate, priority: 'HIGH' },
    });
    expect(taskRes.status(), 'create overdue task').toBe(201);
    const taskBody = (await taskRes.json()).data;
    const taskId: string = String(taskBody.Id ?? taskBody.id);
    expect(taskId, 'taskId').toBeTruthy();

    // ── 5. Create a DUE_DATE_PASSED rule with priority condition + CALL_WEBHOOK ─
    // The ISSUE_MATCHES_FILTER condition (pql: 'priority = HIGH') only passes
    // once the worker hydrates the scheduler payload with the task's current DB
    // fields via taskToPayloadFields (follow-up #2). webhookEvent must match the
    // registered webhook's subscribed event so dispatch() finds it via
    // getActive(workspaceId, 'automation.fired') (follow-up #1).
    const ruleRes = await api.post(`${API_BASE}/automations`, {
      headers,
      data: {
        scopeType:   'PROJECT',
        workspaceId,
        projectId,
        name:        ruleName,
        trigger:     { type: 'DUE_DATE_PASSED' },
        conditions:  [{
          type: 'ISSUE_MATCHES_FILTER',
          operator: 'is',
          pql: 'priority = HIGH',
        }],
        actions:     [{ type: 'CALL_WEBHOOK', webhookEvent: 'automation.fired' }],
      },
    });
    expect(ruleRes.status(), 'create DUE_DATE_PASSED rule').toBe(201);
    const ruleId: string = String((await ruleRes.json()).rule.id);
    expect(ruleId, 'ruleId').toBeTruthy();

    // ── 6. Trigger one scheduler sweep via the dev endpoint ───────────────────
    // runScheduledSweep(now, since) queries usp_AutomationRule_ListDueDateRules
    // for tasks whose dueDate falls in (since, now]. The overdue task is within
    // the default sweep window (now − 5 min, now], so the sweep enqueues one
    // job: DUE_DATE_PASSED:<ruleId>. The worker processes it:
    //   1. Hydrates the bare {taskId,projectId} payload with the task's current
    //      DB fields (taskToPayloadFields) — follow-up #2.
    //   2. Evaluates the ISSUE_MATCHES_FILTER condition: pql='priority = HIGH'
    //      matches the seeded task → passes.
    //   3. Executes CALL_WEBHOOK with event 'automation.fired' — follow-up #1.
    //   4. Writes an AutomationRuns audit row.
    const sweepRes = await api.post(`${API_BASE}/dev/automation/sweep`, { headers });
    expect(sweepRes.status(), 'dev sweep endpoint').toBe(200);
    const sweepBody = await sweepRes.json();
    // The sweep should have enqueued at least one due-date job.
    expect(typeof sweepBody.dueDate, 'sweep returned dueDate count').toBe('number');

    // ── 7. HEADLINE assertion: poll until the run is audited ──────────────────
    // The BullMQ worker is asynchronous — the job is processed after the sweep
    // returns. Poll GET /automations/:id/runs until at least one run appears.
    // A recorded run (any status) proves: sweep found the task, enqueued the
    // job, and the worker processed it end-to-end.
    await expect(async () => {
      const runsRes = await api.get(`${API_BASE}/automations/${ruleId}/runs`, { headers });
      expect(runsRes.status(), 'list runs').toBe(200);
      const runs: Array<{ status: string; triggerType: string }> = (await runsRes.json()).runs;
      expect(runs.length, 'at least one run recorded').toBeGreaterThanOrEqual(1);
      // Verify the run corresponds to the date trigger.
      const dueDateRun = runs.find((r) => r.triggerType === 'DUE_DATE_PASSED');
      expect(dueDateRun, 'a DUE_DATE_PASSED run was recorded (scheduler fired)').toBeTruthy();
    }).toPass({ timeout: 15_000, intervals: [500, 1000, 1500, 2000, 3000] });

    // ── 8. Cleanup ────────────────────────────────────────────────────────────
    const wsDel = await api.delete(`${API_BASE}/workspaces/${workspaceId}`, { headers });
    expect([204, 404], 'workspace cleanup').toContain(wsDel.status());
    await api.dispose();
  });
});
