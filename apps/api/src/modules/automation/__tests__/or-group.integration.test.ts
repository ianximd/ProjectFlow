/**
 * Phase 6b — condition engine OR-group acceptance (spec §5.5).
 * A rule with a top-level OR group, stored via the real API + SP, round-trips
 * and evaluates to fire for EITHER branch and not when neither matches.
 * DB SAFETY: controller runs this ONLY against local Docker ProjectFlow_Test.
 *
 * Mirrors engine.integration.test.ts for the harness + auth + create body.
 * There is NO BullMQ worker in integration tests: this exercises the condition
 * engine directly via getRuleById → parseConditionTree → evaluateConditionTree.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';
import { AutomationRepository } from '../automation.repository.js';
import { parseConditionTree, evaluateConditionTree } from '../condition.tree.js';
import { buildConditionContext } from '../condition.context.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

const repo = new AutomationRepository();

let seq = 0;

async function seed() {
  seq += 1;
  const owner = await createTestUser({ email: `or-grp-${Date.now()}-${seq}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const project = await createTestProject(ws.Id, token, {
    name: 'OrGrp',
    key: `OG${(Date.now() + seq) % 100000}`,
  });
  return { token, userId: owner.user.Id, workspaceId: ws.Id, projectId: project.Id };
}

// A rule whose conditions are a top-level OR group: fire if priority is HIGH OR
// status is Blocked. The action is a valid 6a action that is never executed here.
async function createOrRule() {
  const { token, userId, workspaceId, projectId } = await seed();
  const { rule } = await json<{ rule: any }>(
    await request('/automations', {
      method: 'POST',
      token,
      json: {
        scopeType:   'PROJECT',
        workspaceId,
        projectId,
        name:        'Escalate HIGH or Blocked',
        trigger:     { type: 'TASK_UPDATED' },
        conditions:  {
          op: 'OR',
          children: [
            { type: 'FIELD_EQUALS', field: 'priority', operator: 'is', value: 'HIGH' },
            { type: 'FIELD_EQUALS', field: 'status',   operator: 'is', value: 'Blocked' },
          ],
        },
        actions:     [{ type: 'POST_COMMENT', message: 'escalated' }],
      },
    }),
    201,
  );
  return { rule, userId, workspaceId, projectId };
}

describe('condition engine — OR group (spec §5.5)', () => {
  it('the OR tree round-trips through create + getRuleById', async () => {
    const { rule } = await createOrRule();

    const stored = await repo.getRuleById(rule.id);
    expect(stored).not.toBeNull();
    // conditions is the AutomationCondition[] | ConditionNode union; here it is the stored OR tree.
    const conditions = stored!.conditions as any;
    expect(conditions.op).toBe('OR');
    expect(conditions.children).toHaveLength(2);
    expect(conditions.children.map((c: any) => c.field)).toEqual(['priority', 'status']);
  });

  it('fires when the first branch matches (priority HIGH)', async () => {
    const { rule, userId, workspaceId } = await createOrRule();

    const stored = await repo.getRuleById(rule.id);
    const tree = parseConditionTree(stored!.conditions);
    const ctx = buildConditionContext(
      { priority: 'HIGH', status: 'In Progress', actorId: userId },
      { workspaceId },
    );
    expect(await evaluateConditionTree(tree, ctx)).toBe(true);
  });

  it('fires when the second branch matches (status Blocked)', async () => {
    const { rule, userId, workspaceId } = await createOrRule();

    const stored = await repo.getRuleById(rule.id);
    const tree = parseConditionTree(stored!.conditions);
    const ctx = buildConditionContext(
      { priority: 'LOW', status: 'Blocked', actorId: userId },
      { workspaceId },
    );
    expect(await evaluateConditionTree(tree, ctx)).toBe(true);
  });

  it('does NOT fire when neither branch matches', async () => {
    const { rule, userId, workspaceId } = await createOrRule();

    const stored = await repo.getRuleById(rule.id);
    const tree = parseConditionTree(stored!.conditions);
    const ctx = buildConditionContext(
      { priority: 'LOW', status: 'In Progress', actorId: userId },
      { workspaceId },
    );
    expect(await evaluateConditionTree(tree, ctx)).toBe(false);
  });
});
