/**
 * Phase 9c — Scheduled reports integration coverage (local Docker ProjectFlow_Test).
 *   - a due schedule produces exactly ONE run + ONE inbox notification per period,
 *   - a worker restart (second sweep, same period) does NOT double-deliver,
 *   - advancing past the cadence endsAt disables the schedule,
 *   - REST scheduled_report.manage gate fail-closes cross-tenant (negative authz).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool, getPool } from '../../../shared/lib/db.js';
import { scheduledReportService } from '../scheduled-report.service.js';
import { scheduledReportRepository } from '../scheduled-report.repository.js';
import { runScheduledReportSweep } from '../scheduled-report.worker.js';
import { notificationService } from '../../notifications/notification.service.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

let seq = 0;

async function seedDashboard() {
  seq += 1;
  const owner = await createTestUser({ email: `sr-${Date.now()}-${seq}@projectflow.test` });
  const recipient = await createTestUser({ email: `sr-rcpt-${Date.now()}-${seq}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, { name: 'SR Space', key: `SR${(Date.now() + seq) % 100000}` });

  // List + task so the SPACE-scope calculation card resolves real rows.
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'L', position: 0 },
  }), 201)).data;
  const listId = String(list.id ?? list.Id);
  await request('/tasks', { method: 'POST', token, json: { workspaceId: ws.Id, listId, title: 'T', type: 'TASK' } });

  // Space-scoped dashboard + one calculation (count) card.
  const dash = (await json<{ data: any }>(await request('/dashboards', {
    method: 'POST', token, json: { scopeType: 'space', scopeId: space.Id, name: 'Weekly status' },
  }), 201)).data;
  const dashboardId = String(dash.id ?? dash.Id);
  await request(`/dashboards/${dashboardId}/cards`, {
    method: 'POST', token,
    json: { type: 'calculation', title: 'Open tasks', config: { aggregate: { op: 'count' }, filter: { conjunction: 'AND', rules: [] } }, layout: { x: 0, y: 0, w: 4, h: 2 } },
  });

  return { owner, recipientId: String(recipient.user.Id), token, ws, space, dashboardId };
}

async function forceNextRunAt(scheduleId: string, when: Date | null): Promise<void> {
  const pool = await getPool();
  await pool.request()
    .input('Id', sql.UniqueIdentifier, scheduleId)
    .input('When', sql.DateTime2, when)
    .query('UPDATE dbo.ScheduledReports SET NextRunAt = @When WHERE Id = @Id');
}

describe('Phase 9c — scheduled reports (integration)', () => {
  it('a due schedule produces exactly one run + one inbox notification per period', async () => {
    const ctx = await seedDashboard();
    const schedule = await scheduledReportService.create({
      workspaceId: ctx.ws.Id, dashboardId: ctx.dashboardId,
      cadence: { freq: 'daily', interval: 1 }, deliveryChannel: 'inbox', recipients: [ctx.recipientId],
    }, ctx.owner.user.Id);

    await forceNextRunAt(schedule.id, new Date(Date.now() - 60_000));

    const result = await runScheduledReportSweep(new Date());
    expect(result.delivered).toBe(1);

    const { runs } = await scheduledReportRepository.listRuns(schedule.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('delivered');
    expect(runs[0].snapshotRef).not.toBeNull();

    const { notifications } = await notificationService.list(ctx.recipientId, 1, 50, false, ['SCHEDULED_REPORT_READY']);
    expect(notifications).toHaveLength(1);
    expect(String(notifications[0].payload.scheduledReportId).toUpperCase()).toBe(schedule.id.toUpperCase());

    const after = await scheduledReportService.getById(schedule.id);
    expect(after!.enabled).toBe(true);
    expect(new Date(after!.nextRunAt as any).getTime()).toBeGreaterThan(Date.now());
  });

  it('a worker restart (second sweep over the same period) does not double-deliver', async () => {
    const ctx = await seedDashboard();
    const schedule = await scheduledReportService.create({
      workspaceId: ctx.ws.Id, dashboardId: ctx.dashboardId,
      cadence: { freq: 'daily', interval: 1 }, deliveryChannel: 'inbox', recipients: [ctx.recipientId],
    }, ctx.owner.user.Id);
    await forceNextRunAt(schedule.id, new Date(Date.now() - 60_000));

    await runScheduledReportSweep(new Date());
    await forceNextRunAt(schedule.id, new Date(Date.now() - 60_000));
    await runScheduledReportSweep(new Date());

    const { runs } = await scheduledReportRepository.listRuns(schedule.id);
    expect(runs.filter((r) => r.status === 'delivered')).toHaveLength(1);
    const { notifications } = await notificationService.list(ctx.recipientId, 1, 50, false, ['SCHEDULED_REPORT_READY']);
    expect(notifications).toHaveLength(1);
  });

  it('advancing past the cadence endsAt disables the schedule', async () => {
    const ctx = await seedDashboard();
    const past = new Date(Date.now() - 60_000).toISOString();
    const schedule = await scheduledReportService.create({
      workspaceId: ctx.ws.Id, dashboardId: ctx.dashboardId,
      cadence: { freq: 'daily', interval: 1, endsAt: past }, deliveryChannel: 'inbox', recipients: [ctx.recipientId],
    }, ctx.owner.user.Id);
    await forceNextRunAt(schedule.id, new Date(Date.now() - 60_000));

    await runScheduledReportSweep(new Date());

    const after = await scheduledReportService.getById(schedule.id);
    expect(after!.enabled).toBe(false);
    expect(after!.nextRunAt).toBeNull();
  });

  it('REST: a non-member is fail-closed (403) on every scheduled-report surface', async () => {
    const ctx = await seedDashboard();
    // victim owner schedules in their workspace
    const schedule = await scheduledReportService.create({
      workspaceId: ctx.ws.Id, dashboardId: ctx.dashboardId,
      cadence: { freq: 'daily', interval: 1 }, deliveryChannel: 'inbox', recipients: [ctx.recipientId],
    }, ctx.owner.user.Id);

    // attacker: a different user in a DIFFERENT workspace
    const attacker = await createTestUser({ email: `sr-atk-${Date.now()}-${seq}@projectflow.test` });
    const atkToken = attacker.accessToken;

    const listRes = await request(`/scheduled-reports?workspaceId=${ctx.ws.Id}`, { token: atkToken });
    expect(listRes.status).toBe(403);

    const createRes = await request('/scheduled-reports', {
      method: 'POST', token: atkToken,
      json: { workspaceId: ctx.ws.Id, dashboardId: ctx.dashboardId, cadence: { freq: 'daily', interval: 1 }, recipients: [String(attacker.user.Id)] },
    });
    expect(createRes.status).toBe(403);

    const patchRes = await request(`/scheduled-reports/${schedule.id}`, { method: 'PATCH', token: atkToken, json: { enabled: false } });
    expect(patchRes.status).toBe(403);

    const delRes = await request(`/scheduled-reports/${schedule.id}`, { method: 'DELETE', token: atkToken });
    expect(delRes.status).toBe(403);

    const runsRes = await request(`/scheduled-reports/${schedule.id}/runs`, { token: atkToken });
    expect(runsRes.status).toBe(403);
  });

  it('REST: the owner can list + create via the gated routes', async () => {
    const ctx = await seedDashboard();
    const createRes = await json<{ data: any }>(await request('/scheduled-reports', {
      method: 'POST', token: ctx.token,
      json: { workspaceId: ctx.ws.Id, dashboardId: ctx.dashboardId, cadence: { freq: 'weekly', interval: 1, byWeekday: [1] }, recipients: [ctx.recipientId] },
    }), 201);
    expect(createRes.data.id).toBeDefined();

    const listRes = await json<{ data: any[] }>(await request(`/scheduled-reports?workspaceId=${ctx.ws.Id}`, { token: ctx.token }), 200);
    expect(listRes.data.length).toBeGreaterThanOrEqual(1);
  });
});
