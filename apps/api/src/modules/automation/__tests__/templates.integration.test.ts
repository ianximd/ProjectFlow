/**
 * Phase 6d — template catalog / metering integration coverage (+ run-history reuse).
 * Reads the 6a AutomationRuns/AutomationUsage tables against the REAL SQL stack.
 * DB SAFETY: must target local Docker ProjectFlow_Test.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';
import { AutomationRepository } from '../automation.repository.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

const repo = new AutomationRepository();
let seq = 0;
async function seed() {
  seq += 1;
  const owner = await createTestUser({ email: `tpl-${Date.now()}-${seq}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const project = await createTestProject(ws.Id, token, { name: 'Tpl', key: `TP${(Date.now() + seq) % 100000}` });
  return { token, userId: owner.user.Id, workspaceId: ws.Id, projectId: project.Id };
}

describe('automation templates + metering (6d)', () => {
  it('GET /automations/templates returns the localized catalog (15–20)', async () => {
    const { token } = await seed();
    const { templates } = await json<{ templates: any[] }>(
      await request('/automations/templates', { token }),
    );
    expect(templates.length).toBeGreaterThanOrEqual(15);
    expect(templates.length).toBeLessThanOrEqual(20);
    expect(templates[0]).toHaveProperty('key');
    expect(templates[0]).toHaveProperty('title');
    expect(templates[0]).toHaveProperty('trigger');
    expect(templates[0]).toHaveProperty('actions');
  });

  it('instantiating a template yields a savable rule whose config matches the catalog', async () => {
    const { token, workspaceId, projectId } = await seed();
    const { templates } = await json<{ templates: any[] }>(await request('/automations/templates', { token }));
    const tpl = templates.find((t) => t.key === 'webhook-on-done');
    expect(tpl).toBeTruthy();

    const { rule } = await json<{ rule: any }>(
      await request('/automations', {
        method: 'POST', token,
        json: { scopeType: 'PROJECT', workspaceId, projectId, name: 'From template', trigger: tpl.trigger, conditions: tpl.conditions, actions: tpl.actions },
      }),
      201,
    );
    expect(rule.trigger.type).toBe('STATUS_CHANGED');
    expect(rule.actions[0].type).toBe('CALL_WEBHOOK');
  });

  it('a FIELD_CHANGED template round-trips trigger.field (no silent strip)', async () => {
    const { token, workspaceId, projectId } = await seed();
    const { templates } = await json<{ templates: any[] }>(await request('/automations/templates', { token }));
    const tpl = templates.find((t) => t.key === 'set-priority-on-label');
    expect(tpl?.trigger?.field).toBe('tags');
    const { rule } = await json<{ rule: any }>(
      await request('/automations', {
        method: 'POST', token,
        json: { scopeType: 'PROJECT', workspaceId, projectId, name: 'Field rule', trigger: tpl.trigger, conditions: tpl.conditions, actions: tpl.actions },
      }),
      201,
    );
    expect(rule.trigger.field).toBe('tags');
  });

  it('GET /automations/:id/runs returns audited runs newest-first (existing 6a route)', async () => {
    const { token, workspaceId, projectId } = await seed();
    const { rule } = await json<{ rule: any }>(
      await request('/automations', {
        method: 'POST', token,
        json: { scopeType: 'PROJECT', workspaceId, projectId, name: 'Notify on create', trigger: { type: 'TASK_CREATED' }, conditions: [], actions: [{ type: 'SEND_NOTIFICATION', message: 'hi' }] },
      }),
      201,
    );
    // Empty initially.
    const empty = await json<{ runs: any[] }>(await request(`/automations/${rule.id}/runs?limit=10`, { token }));
    expect(empty.runs.length).toBe(0);

    // Insert two audited runs directly via the worker's record path.
    await repo.recordRun({ ruleId: rule.id, workspaceId, projectId, triggerType: 'TASK_CREATED', status: 'success', depth: 0, startedAt: new Date(Date.now() - 1000) });
    await repo.recordRun({ ruleId: rule.id, workspaceId, projectId, triggerType: 'TASK_CREATED', status: 'skipped', depth: 0, startedAt: new Date() });

    const page = await json<{ runs: any[] }>(await request(`/automations/${rule.id}/runs?limit=10`, { token }));
    expect(page.runs.length).toBe(2);
    expect(page.runs[0].ruleId).toBe(rule.id);
    expect(['success', 'partial', 'skipped', 'failed', 'loop_blocked']).toContain(page.runs[0].status);
    // newest-first: the later-startedAt 'skipped' run comes first.
    expect(page.runs[0].status).toBe('skipped');
  });

  it('GET /automations/usage returns the current-period run count', async () => {
    const { token, workspaceId } = await seed();
    const { usage } = await json<{ usage: any }>(
      await request(`/automations/usage?workspaceId=${workspaceId}`, { token }),
    );
    expect(usage.workspaceId).toBe(workspaceId);
    expect(usage.period).toMatch(/^\d{6}$/);
    expect(typeof usage.runCount).toBe('number');
  });

  it('GET /automations/usage counts a recorded success run (write→read period match)', async () => {
    const { token, workspaceId, projectId } = await seed();
    const { rule } = await json<{ rule: any }>(
      await request('/automations', {
        method: 'POST', token,
        json: { scopeType: 'PROJECT', workspaceId, projectId, name: 'Metered', trigger: { type: 'TASK_CREATED' }, conditions: [], actions: [{ type: 'SEND_NOTIFICATION', message: 'hi' }] },
      }),
      201,
    );
    const before = await json<{ usage: any }>(await request(`/automations/usage?workspaceId=${workspaceId}`, { token }));
    expect(before.usage.runCount).toBe(0);
    // A 'success' run meters; the read must hit the SAME (WorkspaceId, period) row.
    await repo.recordRun({ ruleId: rule.id, workspaceId, projectId, triggerType: 'TASK_CREATED', status: 'success', depth: 0, startedAt: new Date() });
    const after = await json<{ usage: any }>(await request(`/automations/usage?workspaceId=${workspaceId}`, { token }));
    expect(after.usage.runCount).toBe(1);
  });
});
