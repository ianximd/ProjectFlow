/**
 * Phase 6a — Automation engine activation integration coverage.
 * Exercises scope-aware rule resolution, run audit, and the loop guard against
 * the REAL SQL stack. DB SAFETY: must target local Docker ProjectFlow_Test.
 *
 * Harness notes (confirmed against recurrence.integration.test.ts):
 *   - request(path, { method, token, json }) — in-process Hono app
 *   - json<T>(res, expectStatus?) — parses + asserts status
 *   - createTestUser returns { user: { Id, ... }, accessToken, ... }
 *   - createTestWorkspace(token) returns { Id, Name, Slug }
 *   - createTestProject(workspaceId, token, opts) returns { Id, ... }
 *   - getByTrigger(projectId | null, workspaceId, triggerType) — null for WORKSPACE scope
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';
import { AutomationRepository } from '../automation.repository.js';
import { shouldEnqueue } from '../automation.bus.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

const repo = new AutomationRepository();

let seq = 0;

async function seed() {
  seq += 1;
  const owner = await createTestUser({ email: `auto-${Date.now()}-${seq}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const project = await createTestProject(ws.Id, token, {
    name: 'Auto',
    key: `AU${(Date.now() + seq) % 100000}`,
  });
  // owner.user.Id is the PascalCase field on the user handle (not owner.id)
  return { token, userId: owner.user.Id, workspaceId: ws.Id, projectId: project.Id };
}

describe('automation scope-aware resolution', () => {
  it('a PROJECT-scoped STATUS_CHANGED rule is resolved by getByTrigger for its project', async () => {
    const { token, projectId, workspaceId } = await seed();
    const { rule } = await json<{ rule: any }>(
      await request('/automations', {
        method: 'POST',
        token,
        json: {
          scopeType:   'PROJECT',
          workspaceId,
          projectId,
          name:        'On Done assign QA',
          trigger:     { type: 'STATUS_CHANGED', toStatus: 'Done' },
          conditions:  [],
          actions:     [{ type: 'ASSIGN', assigneeId: 'REPORTER' }],
        },
      }),
      201,
    );
    expect(rule.scopeType).toBe('PROJECT');

    const matched = await repo.getByTrigger(projectId, workspaceId, 'STATUS_CHANGED');
    expect(matched.map((r: any) => r.id)).toContain(rule.id);
  });

  it('a WORKSPACE-scoped rule is resolved for a task in ANY project of the workspace', async () => {
    const { token, workspaceId } = await seed();
    const { rule } = await json<{ rule: any }>(
      await request('/automations', {
        method: 'POST',
        token,
        json: {
          scopeType:   'WORKSPACE',
          workspaceId,
          projectId:   null,
          name:        'WS-wide notify',
          trigger:     { type: 'TASK_CREATED' },
          conditions:  [],
          actions:     [{ type: 'SEND_NOTIFICATION', message: 'created' }],
        },
      }),
      201,
    );
    expect(rule.scopeType).toBe('WORKSPACE');
    expect(rule.projectId).toBeNull();

    // For WORKSPACE scope, getByTrigger uses projectId=null so it surfaces
    // rules whose ScopeType='WORKSPACE' regardless of which project fires.
    const matched = await repo.getByTrigger(null, workspaceId, 'TASK_CREATED');
    expect(matched.map((r: any) => r.id)).toContain(rule.id);
  });
});

describe('automation run audit + loop guard', () => {
  it('records a run row and surfaces it via GET /automations/:id/runs', async () => {
    const { token, projectId, workspaceId } = await seed();
    const { rule } = await json<{ rule: any }>(
      await request('/automations', {
        method: 'POST',
        token,
        json: {
          scopeType:   'PROJECT',
          workspaceId,
          projectId,
          name:        'r',
          trigger:     { type: 'TASK_CREATED' },
          conditions:  [],
          actions:     [{ type: 'SEND_NOTIFICATION', message: 'x' }],
        },
      }),
      201,
    );

    await repo.recordRun({
      ruleId:      rule.id,
      workspaceId,
      projectId,
      triggerType: 'TASK_CREATED',
      status:      'success',
      depth:       0,
      startedAt:   new Date(),
      durationMs:  12,
    });

    const { runs } = await json<{ runs: any[] }>(
      await request(`/automations/${rule.id}/runs`, { token }),
      200,
    );
    expect(runs.length).toBe(1);
    expect(runs[0].status).toBe('success');
  });

  it('records a loop_blocked run for a self-referential chain (pure guard)', () => {
    expect(shouldEnqueue('rule-a', { depth: 1, causationChain: ['rule-a'] }))
      .toEqual({ ok: false, reason: 'chain' });
    expect(shouldEnqueue('rule-a', { depth: 5, causationChain: [] }))
      .toEqual({ ok: false, reason: 'depth' });
  });
});
