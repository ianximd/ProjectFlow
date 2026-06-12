/**
 * Phase 8b — Timesheets REST integration coverage.
 * Exercises the get-or-create / aggregate / submit / review surface against the
 * REAL SQL stack. DB SAFETY: must target local Docker ProjectFlow_Test.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import {
  createTestUser, createTestWorkspace, createTestProject, createTestTask,
} from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';
import type { Timesheet, TimesheetAggregate } from '@projectflow/types';

beforeEach(async () => { await truncateAll(); });
afterAll  (async () => { await closePool();   });

const PERIOD = { workspaceId: '', periodStart: '2026-06-01', periodEnd: '2026-06-07' };

describe('Timesheets REST', () => {
  it('GET /timesheets get-or-creates a draft and aggregates logged time, then submit→approve', async () => {
    const owner   = await createTestUser({ email: 'ts-owner@projectflow.test' });
    const ws      = await createTestWorkspace(owner.accessToken);
    const project = await createTestProject(ws.Id, owner.accessToken);
    const task    = await createTestTask(project.Id, ws.Id, owner.accessToken);

    // 8a worklog write: a closed, billable 1h entry inside the period.
    await request('/worklogs', {
      method: 'POST', token: owner.accessToken,
      json: { taskId: task.Id, timeSpentSeconds: 3600,
              startedAt: '2026-06-02T09:00:00.000Z', billable: true, source: 'manual' },
    });

    const listed = await request(
      `/timesheets?workspaceId=${ws.Id}&periodStart=${PERIOD.periodStart}&periodEnd=${PERIOD.periodEnd}`,
      { token: owner.accessToken },
    );
    const { data } = await json<{ data: Timesheet }>(listed, 200);
    expect(data.status).toBe('draft');

    const agg = await request(`/timesheets/${data.id}/aggregate`, { token: owner.accessToken });
    const aggBody = await json<{ data: TimesheetAggregate }>(agg, 200);
    expect(aggBody.data.totals.totalSeconds).toBe(3600);
    expect(aggBody.data.totals.billableSeconds).toBe(3600);

    const submitted = await request(`/timesheets/${data.id}/submit`, { method: 'POST', token: owner.accessToken, json: {} });
    const subBody = await json<{ data: Timesheet }>(submitted, 200);
    expect(subBody.data.status).toBe('submitted');

    const reviewed = await request(`/timesheets/${data.id}/review`, {
      method: 'POST', token: owner.accessToken, json: { decision: 'approved' },
    });
    const revBody = await json<{ data: Timesheet }>(reviewed, 200);
    expect(revBody.data.status).toBe('approved');
  });

  it('locks worklog writes inside a submitted period → 422', async () => {
    const owner   = await createTestUser({ email: 'ts-lock@projectflow.test' });
    const ws      = await createTestWorkspace(owner.accessToken);
    const project = await createTestProject(ws.Id, owner.accessToken);
    const task    = await createTestTask(project.Id, ws.Id, owner.accessToken);

    await request('/worklogs', {
      method: 'POST', token: owner.accessToken,
      json: { taskId: task.Id, timeSpentSeconds: 3600, startedAt: '2026-06-02T09:00:00.000Z', source: 'manual' },
    });
    const listed = await request(
      `/timesheets?workspaceId=${ws.Id}&periodStart=${PERIOD.periodStart}&periodEnd=${PERIOD.periodEnd}`,
      { token: owner.accessToken },
    );
    const { data } = await json<{ data: Timesheet }>(listed, 200);
    await request(`/timesheets/${data.id}/submit`, { method: 'POST', token: owner.accessToken, json: {} });

    const blocked = await request('/worklogs', {
      method: 'POST', token: owner.accessToken,
      json: { taskId: task.Id, timeSpentSeconds: 600, startedAt: '2026-06-03T09:00:00.000Z', source: 'manual' },
    });
    expect(blocked.status).toBe(422);
  });

  it('rejects an illegal review (timesheet still draft) with 409', async () => {
    const owner   = await createTestUser({ email: 'ts-illegal@projectflow.test' });
    const ws      = await createTestWorkspace(owner.accessToken);
    const listed = await request(
      `/timesheets?workspaceId=${ws.Id}&periodStart=${PERIOD.periodStart}&periodEnd=${PERIOD.periodEnd}`,
      { token: owner.accessToken },
    );
    const { data } = await json<{ data: Timesheet }>(listed, 200);
    const res = await request(`/timesheets/${data.id}/review`, {
      method: 'POST', token: owner.accessToken, json: { decision: 'approved' },
    });
    expect(res.status).toBe(409);
  });

  it('forbids a non-member (403) on get-or-create / read / aggregate / submit / review', async () => {
    const owner = await createTestUser({ email: 'ts-authz-owner@projectflow.test' });
    const ws    = await createTestWorkspace(owner.accessToken);
    const listed = await request(
      `/timesheets?workspaceId=${ws.Id}&periodStart=${PERIOD.periodStart}&periodEnd=${PERIOD.periodEnd}`,
      { token: owner.accessToken },
    );
    const { data } = await json<{ data: Timesheet }>(listed, 200);

    // A second user who is NOT a member of `ws` must be fail-closed on every surface.
    const intruder = await createTestUser({ email: 'ts-authz-intruder@projectflow.test' });

    const getOrCreate = await request(
      `/timesheets?workspaceId=${ws.Id}&periodStart=${PERIOD.periodStart}&periodEnd=${PERIOD.periodEnd}`,
      { token: intruder.accessToken },
    );
    expect(getOrCreate.status).toBe(403);
    expect((await request(`/timesheets/${data.id}`,           { token: intruder.accessToken })).status).toBe(403);
    expect((await request(`/timesheets/${data.id}/aggregate`, { token: intruder.accessToken })).status).toBe(403);
    expect((await request(`/timesheets/${data.id}/submit`, { method: 'POST', token: intruder.accessToken, json: {} })).status).toBe(403);
    expect((await request(`/timesheets/${data.id}/review`, { method: 'POST', token: intruder.accessToken, json: { decision: 'approved' } })).status).toBe(403);
  });

  it('locks an UPDATE that moves a worklog OUT of a submitted period → 422', async () => {
    const owner   = await createTestUser({ email: 'ts-moveout@projectflow.test' });
    const ws      = await createTestWorkspace(owner.accessToken);
    const project = await createTestProject(ws.Id, owner.accessToken);
    const task    = await createTestTask(project.Id, ws.Id, owner.accessToken);

    // A closed entry INSIDE the period.
    const created = await request('/worklogs', {
      method: 'POST', token: owner.accessToken,
      json: { taskId: task.Id, timeSpentSeconds: 3600, startedAt: '2026-06-02T09:00:00.000Z', source: 'manual' },
    });
    const { log } = await json<{ log: { id: string } }>(created, 201);

    // Submit → the period is now locked.
    const listed = await request(
      `/timesheets?workspaceId=${ws.Id}&periodStart=${PERIOD.periodStart}&periodEnd=${PERIOD.periodEnd}`,
      { token: owner.accessToken },
    );
    const { data } = await json<{ data: Timesheet }>(listed, 200);
    await request(`/timesheets/${data.id}/submit`, { method: 'POST', token: owner.accessToken, json: {} });

    // Trying to MOVE the locked entry to an unlocked date must still be rejected:
    // locked time is immutable (the lock checks the entry's CURRENT date, not just
    // the destination).
    const moved = await request(`/worklogs/${log.id}`, {
      method: 'PATCH', token: owner.accessToken,
      json: { startedAt: '2026-07-15T09:00:00.000Z' },
    });
    expect(moved.status).toBe(422);
  });
});
