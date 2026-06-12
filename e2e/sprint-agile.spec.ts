/**
 * E2E: Phase 8c — Sprints/Agile headline flow (API-driven, over the real HTTP stack).
 *
 * Sets up a sprint folder (auto-complete + roll-forward ON), creates a sprint that
 * already ended + starts it (ACTIVE), adds an open task with story points to the
 * sprint List, triggers the scheduler sweep via the dev-only /sprints/_sweep
 * endpoint, and verifies: the sprint auto-COMPLETED, a NEXT sprint was created in
 * the folder, the open task rolled into it, and the points rollup is readable.
 *
 * Operational notes
 * ─────────────────
 * 1. Requires a running API + local Docker ProjectFlow_Test DB (NOT prod). The
 *    sweep runs synchronously in-process (runSprintSweep), no Redis needed.
 * 2. Run ONLY with explicit local DB env (DB_SERVER=localhost … DB_NAME=ProjectFlow_Test).
 * 3. The /sprints/_sweep endpoint is mounted only when NODE_ENV !== 'production'.
 */

import { test, expect, request as playwrightRequest } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';

function uniqSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

test('sprint auto-completes at end date and rolls unfinished tasks to the next sprint', async () => {
  const suffix = uniqSuffix();
  const email = `e2e-sprint-${suffix}@projectflow.test`;
  const password = 'E2EPass123!';
  const api = await playwrightRequest.newContext();

  expect((await api.post(`${API_BASE}/auth/register`, {
    data: { email, name: `Sprint User ${suffix}`, password },
  })).status(), 'register').toBe(201);

  const { data: { token } } = await (await api.post(`${API_BASE}/auth/login`, { data: { email, password } })).json();
  const headers = { Authorization: `Bearer ${token}` };

  const ws = (await (await api.post(`${API_BASE}/workspaces`, {
    headers, data: { name: `Sprint WS ${suffix}`, slug: `sprint-ws-${suffix}` },
  })).json()).data;
  const workspaceId: string = ws.Id ?? ws.id;
  expect(workspaceId, 'workspaceId').toBeTruthy();

  const proj = (await (await api.post(`${API_BASE}/projects`, {
    headers, data: { workspaceId, name: `Sprint Project ${suffix}`, key: `SP${suffix.slice(-4).toUpperCase()}`, type: 'KANBAN' },
  })).json()).data;
  const projectId: string = proj.Id ?? proj.id;
  expect(projectId, 'projectId').toBeTruthy();

  // A sprint Folder (any folder; the settings PUT flags it as a sprint folder).
  const folder = (await (await api.post(`${API_BASE}/folders`, {
    headers, data: { workspaceId, spaceId: projectId, name: 'Sprints', position: 0 },
  })).json()).data;
  const folderId: string = folder.Id ?? folder.id;
  expect(folderId, 'folderId').toBeTruthy();

  // Enable auto-complete + roll-forward on the sprint folder.
  const settingsRes = await api.put(`${API_BASE}/sprints/folders/${folderId}/settings`, {
    headers, data: { durationDays: 14, startDayOfWeek: null, autoStart: false, autoComplete: true, autoRollForward: true, pointsFieldId: null },
  });
  expect(settingsRes.status(), 'PUT settings').toBe(200);

  // Create a sprint that ended yesterday, then start it (so it is ACTIVE).
  const now = Date.now();
  const startDate = new Date(now - 15 * 24 * 3600 * 1000).toISOString();
  const endDate = new Date(now - 24 * 3600 * 1000).toISOString();
  const sprint = (await (await api.post(`${API_BASE}/sprints/folders/${folderId}/sprints`, {
    headers, data: { name: 'S1', startDate, endDate },
  })).json()).data;
  const sprintId: string = sprint.Id ?? sprint.id;
  const listId: string = sprint.ListId ?? sprint.listId;
  expect(sprintId, 'sprintId').toBeTruthy();
  expect(listId, 'sprint listId').toBeTruthy();

  expect((await api.post(`${API_BASE}/sprints/${sprintId}/start`, { headers, data: {} })).status(), 'start').toBe(200);

  // Add an open task with story points into the sprint List.
  expect((await api.post(`${API_BASE}/tasks`, {
    headers, data: { workspaceId, listId, title: 'Open work', storyPoints: 5 },
  })).status(), 'create task').toBe(201);

  // Trigger the sweep deterministically (dev-only endpoint).
  const sweep = (await (await api.post(`${API_BASE}/sprints/_sweep`, {
    headers, data: { now: new Date(now).toISOString() },
  })).json()).data;
  expect(sweep.completed, 'sweep completed count').toBeGreaterThanOrEqual(1);

  // S1 is completed.
  const sprints = (await (await api.get(`${API_BASE}/sprints?projectId=${projectId}`, { headers })).json()).data;
  const s1 = sprints.find((s: any) => (s.Id ?? s.id) === sprintId);
  expect(s1.Status ?? s1.status, 'S1 status').toBe('COMPLETED');

  // A next sprint exists and the open task rolled into it (its points show up).
  const next = sprints.find((s: any) => (s.Id ?? s.id) !== sprintId);
  expect(next, 'next sprint created').toBeTruthy();
  const nextId = next.Id ?? next.id;
  const points = (await (await api.get(`${API_BASE}/sprints/${nextId}/points`, { headers })).json()).data;
  expect(points.total.TotalPoints, 'rolled-forward points').toBeGreaterThanOrEqual(5);

  await api.delete(`${API_BASE}/workspaces/${workspaceId}`, { headers });
  await api.dispose();
});
