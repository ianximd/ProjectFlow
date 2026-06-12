/**
 * E2E: Timesheets (Phase 8b).
 * Proves the headline acceptance: a user logs time, the timesheet aggregates it,
 * the user submits, and a reviewer approves.
 * DB SAFETY: run ONLY with the local Docker test DB env (see e2e/README.md).
 */
import { test, expect, request as playwrightRequest } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';
const PERIOD = { periodStart: '2026-06-01', periodEnd: '2026-06-07' };

function uniq() { return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`; }

test('log time, aggregate, submit, approve', async () => {
  const api = await playwrightRequest.newContext();
  const email = `ts-e2e-${uniq()}@projectflow.test`;
  const password = 'Passw0rd!23';

  // Register, then log in over REST to obtain a token + seed graph. The token is
  // returned by the login response at `data.token` (not by register) — mirrors
  // e2e/time-tracking.spec.ts and the timesheet integration tests.
  const reg = await api.post(`${API_BASE}/auth/register`, { data: { email, password, name: 'TS E2E' } });
  expect(reg.status()).toBe(201);
  const login = await api.post(`${API_BASE}/auth/login`, { data: { email, password } });
  expect(login.status()).toBe(200);
  const token = (await login.json()).data.token as string;
  const h = { Authorization: `Bearer ${token}` };

  // Workspace creation requires BOTH name + slug (workspace.routes.ts). Each seed
  // step asserts its id so any failure is pinned to its own call, not surfaced
  // late as a 400 on the worklog write.
  const sfx = uniq();
  const ws = await (await api.post(`${API_BASE}/workspaces`, { headers: h, data: { name: `WS ${sfx}`, slug: `ws-${sfx}` } })).json();
  const wsId = ws.data?.Id ?? ws.Id ?? ws.data?.id;
  expect(wsId, 'workspaceId').toBeTruthy();
  const proj = await (await api.post(`${API_BASE}/projects`, { headers: h, data: { workspaceId: wsId, name: `P ${sfx}`, key: `PT${Math.floor(Math.random()*900+100)}`, type: 'KANBAN' } })).json();
  const projId = proj.data?.Id ?? proj.Id ?? proj.data?.id;
  expect(projId, 'projectId').toBeTruthy();
  const task = await (await api.post(`${API_BASE}/tasks`, { headers: h, data: { projectId: projId, workspaceId: wsId, title: 'Build', type: 'TASK' } })).json();
  const taskId = task.data?.Id ?? task.Id ?? task.data?.id;
  expect(taskId, 'taskId').toBeTruthy();

  // Log a closed 1h billable entry inside the period.
  const wl = await api.post(`${API_BASE}/worklogs`, { headers: h, data: { taskId, timeSpentSeconds: 3600, startedAt: '2026-06-02T09:00:00.000Z', billable: true, source: 'manual' } });
  expect(wl.status()).toBe(201);

  // Get-or-create the envelope + aggregate.
  const tsRes = await api.get(`${API_BASE}/timesheets?workspaceId=${wsId}&periodStart=${PERIOD.periodStart}&periodEnd=${PERIOD.periodEnd}`, { headers: h });
  const tsBody = await tsRes.json();
  const timesheetId = tsBody.data.id;
  const agg = await (await api.get(`${API_BASE}/timesheets/${timesheetId}/aggregate`, { headers: h })).json();
  expect(agg.data.totals.totalSeconds).toBe(3600);
  expect(agg.data.totals.billableSeconds).toBe(3600);

  // Submit then approve.
  const submit = await api.post(`${API_BASE}/timesheets/${timesheetId}/submit`, { headers: h, data: {} });
  expect((await submit.json()).data.status).toBe('submitted');
  const approve = await api.post(`${API_BASE}/timesheets/${timesheetId}/review`, { headers: h, data: { decision: 'approved' } });
  expect((await approve.json()).data.status).toBe('approved');

  // Locked period: a new worklog in the approved period is rejected with 422.
  const blocked = await api.post(`${API_BASE}/worklogs`, { headers: h, data: { taskId, timeSpentSeconds: 600, startedAt: '2026-06-03T09:00:00.000Z', source: 'manual' } });
  expect(blocked.status()).toBe(422);

  await api.dispose();
});
