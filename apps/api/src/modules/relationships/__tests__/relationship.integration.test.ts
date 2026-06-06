/**
 * Phase 5b — Relationships + Rollup integration coverage (Batch 1).
 *
 * Exercises the relationship service + the new SPs against the REAL SQL Server
 * stack: a list-to-list link, a numeric rollup (sum/avg/count) pulling a builtin
 * field off the related tasks, a custom-field-sourced rollup, the relationship
 * field-type config validation at create, the rollup-read-only generic value
 * path, and the cross-workspace IDOR guard (404 at the REST route).
 *
 * DB SAFETY: must target the local Docker ProjectFlow_Test DB (see e2e/README).
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool, getPool } from '../../../shared/lib/db.js';
import { relationshipService } from '../relationship.service.js';
import { customFieldService } from '../../customfields/customfield.service.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

let seq = 0;

/** Seed a workspace + space (project) + two lists owned by a fresh user. */
async function seedGraph() {
  seq += 1;
  const owner = await createTestUser({ email: `rel-${Date.now()}-${seq}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, { name: 'Rel Space', key: `RL${(Date.now() + seq) % 100000}` });
  const mkList = async (name: string) => (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name, position: 0 },
  }), 201)).data;
  const listA = await mkList('List A');
  const listB = await mkList('List B');
  return { owner, token, ws, space, listA: listA.id ?? listA.Id, listB: listB.id ?? listB.Id };
}

type Ctx = Awaited<ReturnType<typeof seedGraph>>;

async function makeTask(ctx: Ctx, listId: string, title: string): Promise<string> {
  const task = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token: ctx.token, json: { workspaceId: ctx.ws.Id, listId, title },
  }), 201)).data;
  return String(task.Id ?? task.id);
}

async function makeField(ctx: Ctx, body: any): Promise<any> {
  return (await json<{ data: any }>(await request('/custom-fields', {
    method: 'POST', token: ctx.token, json: { scopeType: 'SPACE', scopeId: ctx.space.Id, ...body },
  }), 201)).data;
}

async function setStoryPoints(taskId: string, points: number): Promise<void> {
  const pool = await getPool();
  await pool.request().input('Id', taskId).input('SP', points)
    .query('UPDATE dbo.Tasks SET StoryPoints = @SP WHERE Id = @Id');
}

describe('Phase 5b — relationship + rollup (integration)', () => {
  it('links a task across two lists and lists the ToTask ref', async () => {
    const ctx = await seedGraph();
    const relField = await makeField(ctx, { type: 'relationship', name: 'Related', config: { relationshipTargetType: 'any' } });
    const a = await makeTask(ctx, ctx.listA, 'Task A');
    const b = await makeTask(ctx, ctx.listB, 'Task B');

    await relationshipService.add(relField.id, a, b, ctx.ws.Id);
    const refs = await relationshipService.list(relField.id, a, ctx.ws.Id);
    expect(refs.map((r) => r.taskId.toUpperCase())).toContain(b.toUpperCase());
    expect(refs.find((r) => r.taskId.toUpperCase() === b.toUpperCase())?.title).toBe('Task B');

    // remove clears it
    const removed = await relationshipService.remove(relField.id, a, b, ctx.ws.Id);
    expect(removed).toBe(1);
    expect(await relationshipService.list(relField.id, a, ctx.ws.Id)).toHaveLength(0);
  });

  it('rollup (sum/avg/count) pulls a builtin field off related tasks', async () => {
    const ctx = await seedGraph();
    const relField = await makeField(ctx, { type: 'relationship', name: 'Related', config: { relationshipTargetType: 'any' } });
    const sumField = await makeField(ctx, {
      type: 'rollup', name: 'SP sum',
      config: { rollupRelationshipFieldId: relField.id, rollupSourceField: { kind: 'builtin', key: 'storyPoints' }, rollupFunction: 'sum' },
    });
    const avgField = await makeField(ctx, {
      type: 'rollup', name: 'SP avg',
      config: { rollupRelationshipFieldId: relField.id, rollupSourceField: { kind: 'builtin', key: 'storyPoints' }, rollupFunction: 'avg' },
    });
    const cntField = await makeField(ctx, {
      type: 'rollup', name: 'SP count',
      config: { rollupRelationshipFieldId: relField.id, rollupSourceField: { kind: 'builtin', key: 'storyPoints' }, rollupFunction: 'count' },
    });

    const parent = await makeTask(ctx, ctx.listA, 'Parent');
    const c1 = await makeTask(ctx, ctx.listB, 'Child 1');
    const c2 = await makeTask(ctx, ctx.listB, 'Child 2');
    await setStoryPoints(c1, 3);
    await setStoryPoints(c2, 5);
    await relationshipService.add(relField.id, parent, c1, ctx.ws.Id);
    await relationshipService.add(relField.id, parent, c2, ctx.ws.Id);

    const eff = await customFieldService.effectiveForTask(parent);
    const valOf = (id: string) => eff.find((e) => e.field.id === id)?.value;
    expect(valOf(sumField.id)).toBe(8);
    expect(valOf(avgField.id)).toBe(4);
    expect(valOf(cntField.id)).toBe(2);
  });

  it('rollup empty set → null (sum) / 0 (count)', async () => {
    const ctx = await seedGraph();
    const relField = await makeField(ctx, { type: 'relationship', name: 'Related', config: { relationshipTargetType: 'any' } });
    const sumField = await makeField(ctx, {
      type: 'rollup', name: 'SP sum',
      config: { rollupRelationshipFieldId: relField.id, rollupSourceField: { kind: 'builtin', key: 'storyPoints' }, rollupFunction: 'sum' },
    });
    const cntField = await makeField(ctx, {
      type: 'rollup', name: 'SP count',
      config: { rollupRelationshipFieldId: relField.id, rollupSourceField: { kind: 'builtin', key: 'storyPoints' }, rollupFunction: 'count' },
    });
    const lonely = await makeTask(ctx, ctx.listA, 'Lonely');
    const eff = await customFieldService.effectiveForTask(lonely);
    expect(eff.find((e) => e.field.id === sumField.id)?.value).toBeNull();
    expect(eff.find((e) => e.field.id === cntField.id)?.value).toBe(0);
  });

  it('rollup sums a CUSTOM number field across related tasks', async () => {
    const ctx = await seedGraph();
    const relField = await makeField(ctx, { type: 'relationship', name: 'Related', config: { relationshipTargetType: 'any' } });
    const numField = await makeField(ctx, { type: 'number', name: 'Cost' });
    const sumField = await makeField(ctx, {
      type: 'rollup', name: 'Cost sum',
      config: { rollupRelationshipFieldId: relField.id, rollupSourceField: { kind: 'custom', key: numField.id }, rollupFunction: 'sum' },
    });
    const parent = await makeTask(ctx, ctx.listA, 'Parent');
    const c1 = await makeTask(ctx, ctx.listB, 'Child 1');
    const c2 = await makeTask(ctx, ctx.listB, 'Child 2');
    await json(await request(`/tasks/${c1}/fields/${numField.id}`, { method: 'PUT', token: ctx.token, json: { value: 10 } }), 200);
    await json(await request(`/tasks/${c2}/fields/${numField.id}`, { method: 'PUT', token: ctx.token, json: { value: 7 } }), 200);
    await relationshipService.add(relField.id, parent, c1, ctx.ws.Id);
    await relationshipService.add(relField.id, parent, c2, ctx.ws.Id);

    const eff = await customFieldService.effectiveForTask(parent);
    expect(eff.find((e) => e.field.id === sumField.id)?.value).toBe(17);
  });

  it('rejects a direct value write to a rollup field via the generic value path (422)', async () => {
    const ctx = await seedGraph();
    const relField = await makeField(ctx, { type: 'relationship', name: 'Related', config: { relationshipTargetType: 'any' } });
    const rollup = await makeField(ctx, {
      type: 'rollup', name: 'SP sum',
      config: { rollupRelationshipFieldId: relField.id, rollupSourceField: { kind: 'builtin', key: 'storyPoints' }, rollupFunction: 'sum' },
    });
    const task = await makeTask(ctx, ctx.listA, 'T');
    const res = await request(`/tasks/${task}/fields/${rollup.id}`, { method: 'PUT', token: ctx.token, json: { value: 99 } });
    expect(res.status).toBe(422);
    const body = await json<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('ROLLUP_READONLY');
  });

  it('rejects a direct value write to a relationship field via the generic value path (422)', async () => {
    const ctx = await seedGraph();
    const relField = await makeField(ctx, { type: 'relationship', name: 'Related', config: { relationshipTargetType: 'any' } });
    const task = await makeTask(ctx, ctx.listA, 'T');
    const res = await request(`/tasks/${task}/fields/${relField.id}`, { method: 'PUT', token: ctx.token, json: { value: 'TASK-1' } });
    expect(res.status).toBe(422);
    const body = await json<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('RELATIONSHIP_READONLY');
  });

  it('rejects creating a relationship field with bad config (422)', async () => {
    const ctx = await seedGraph();
    const res = await request('/custom-fields', {
      method: 'POST', token: ctx.token,
      json: { scopeType: 'SPACE', scopeId: ctx.space.Id, type: 'relationship', name: 'Bad', config: { relationshipTargetType: 'list' } },
    });
    expect(res.status).toBe(422);
    const body = await json<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('BAD_RELATIONSHIP_CONFIG');
  });

  it('rejects a cross-workspace link with 404 (IDOR guard at the route)', async () => {
    const ctxA = await seedGraph();
    const ctxB = await seedGraph();
    const relField = await makeField(ctxA, { type: 'relationship', name: 'Related', config: { relationshipTargetType: 'any' } });
    const a = await makeTask(ctxA, ctxA.listA, 'WS-A Task');
    const bForeign = await makeTask(ctxB, ctxB.listA, 'WS-B Task');

    const res = await request(`/tasks/${encodeURIComponent(a)}/relationships/${relField.id}`, {
      method: 'POST', token: ctxA.token, json: { toTaskId: bForeign },
    });
    expect(res.status).toBe(404);
    const body = await json<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('NOT_FOUND');

    // Nothing written for A.
    expect(await relationshipService.list(relField.id, a, ctxA.ws.Id)).toHaveLength(0);
  });

  it('full REST round-trip: POST link → GET list → DELETE unlink', async () => {
    const ctx = await seedGraph();
    const relField = await makeField(ctx, { type: 'relationship', name: 'Related', config: { relationshipTargetType: 'any' } });
    const a = await makeTask(ctx, ctx.listA, 'A');
    const b = await makeTask(ctx, ctx.listB, 'B');

    const post = await request(`/tasks/${a}/relationships/${relField.id}`, { method: 'POST', token: ctx.token, json: { toTaskId: b } });
    expect(post.status).toBe(201);

    const got = (await json<{ data: any[] }>(await request(`/tasks/${a}/relationships/${relField.id}`, { token: ctx.token }), 200)).data;
    expect(got.map((r) => r.taskId.toUpperCase())).toContain(b.toUpperCase());

    const del = await request(`/tasks/${a}/relationships/${relField.id}/${b}`, { method: 'DELETE', token: ctx.token });
    expect(del.status).toBe(204);
    const after = (await json<{ data: any[] }>(await request(`/tasks/${a}/relationships/${relField.id}`, { token: ctx.token }), 200)).data;
    expect(after).toHaveLength(0);
  });

  it('cross-workspace remove is a no-op (workspace-scoped Remove SP)', async () => {
    // A real link exists in workspace A. Calling remove with a FOREIGN
    // workspaceId must remove nothing (the SP DELETE is `AND WorkspaceId = @x`),
    // while the same call with the correct workspaceId removes it.
    const ctxA = await seedGraph();
    const ctxB = await seedGraph();
    const relField = await makeField(ctxA, { type: 'relationship', name: 'Related', config: { relationshipTargetType: 'any' } });
    const a = await makeTask(ctxA, ctxA.listA, 'A');
    const b = await makeTask(ctxA, ctxA.listB, 'B');
    await relationshipService.add(relField.id, a, b, ctxA.ws.Id);

    // Foreign workspace → removes nothing, link survives.
    const removedForeign = await relationshipService.remove(relField.id, a, b, ctxB.ws.Id);
    expect(removedForeign).toBe(0);
    expect(await relationshipService.list(relField.id, a, ctxA.ws.Id)).toHaveLength(1);

    // Correct workspace → removes the link.
    const removedOwn = await relationshipService.remove(relField.id, a, b, ctxA.ws.Id);
    expect(removedOwn).toBe(1);
    expect(await relationshipService.list(relField.id, a, ctxA.ws.Id)).toHaveLength(0);
  });

  it('rollup-of-rollup config does not crash → yields null', async () => {
    // A rollup (`outer`) whose source field is ANOTHER rollup (`inner`) must NOT
    // recurse into effectiveForTask (would stack-overflow). readSourceValue
    // short-circuits a rollup-typed source to null, so the aggregate is null.
    const ctx = await seedGraph();
    const relField = await makeField(ctx, { type: 'relationship', name: 'Related', config: { relationshipTargetType: 'any' } });
    const inner = await makeField(ctx, {
      type: 'rollup', name: 'Inner SP sum',
      config: { rollupRelationshipFieldId: relField.id, rollupSourceField: { kind: 'builtin', key: 'storyPoints' }, rollupFunction: 'sum' },
    });
    const outer = await makeField(ctx, {
      type: 'rollup', name: 'Outer (sources the inner rollup)',
      config: { rollupRelationshipFieldId: relField.id, rollupSourceField: { kind: 'custom', key: inner.id }, rollupFunction: 'sum' },
    });

    const parent = await makeTask(ctx, ctx.listA, 'Parent');
    const c1 = await makeTask(ctx, ctx.listB, 'Child 1');
    const c2 = await makeTask(ctx, ctx.listB, 'Child 2');
    await setStoryPoints(c1, 3);
    await setStoryPoints(c2, 5);
    await relationshipService.add(relField.id, parent, c1, ctx.ws.Id);
    await relationshipService.add(relField.id, parent, c2, ctx.ws.Id);

    // Must resolve (not throw/overflow). Inner still computes off builtins;
    // outer sees rollup-typed sources → null per related task → sum of nulls = null.
    const eff = await customFieldService.effectiveForTask(parent);
    expect(eff.find((e) => e.field.id === inner.id)?.value).toBe(8);
    expect(eff.find((e) => e.field.id === outer.id)?.value).toBeNull();
  });
});
