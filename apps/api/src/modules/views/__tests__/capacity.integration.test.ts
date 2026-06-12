/**
 * Integration tests for Phase 8d capacity aggregation.
 *
 * Covers:
 *   - Happy path: time metric, over-capacity flagged + sorted first
 *   - Happy path: points metric
 *   - Range filter: out-of-range tasks excluded
 *   - DATETIME2 upper-bound inclusivity (same-day afternoon task IS included)
 *   - Negative-authz: non-member → 403, non-existent scopeId → 404
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { viewService } from '../view.service.js';
import {
  createTestUser,
  createTestWorkspace,
  createTestProject,
  createTestTask,
} from '../../../__tests__/fixtures/factories.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { closePool, getPool } from '../../../shared/lib/db.js';
import { TaskRepository } from '../../tasks/task.repository.js';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { randomUUID } from 'node:crypto';

const taskRepo = new TaskRepository();

// ── inline SQL helpers ────────────────────────────────────────────────────────

async function setTaskListPath(taskId: string, listPath: string): Promise<void> {
  const pool = await getPool();
  await pool.request()
    .input('Id', taskId)
    .input('LP', listPath)
    .query('UPDATE Tasks SET ListPath = @LP WHERE Id = @Id');
}

async function setTimeEstimate(taskId: string, seconds: number): Promise<void> {
  const pool = await getPool();
  await pool.request()
    .input('Id', taskId)
    .input('S', seconds)
    .query('UPDATE Tasks SET TimeEstimateSeconds = @S WHERE Id = @Id');
}

async function setStoryPoints(taskId: string, points: number): Promise<void> {
  const pool = await getPool();
  await pool.request()
    .input('Id', taskId)
    .input('P', points)
    .query('UPDATE Tasks SET StoryPoints = @P WHERE Id = @Id');
}

async function setDueDate(taskId: string, iso: string): Promise<void> {
  const pool = await getPool();
  await pool.request()
    .input('Id', taskId)
    .input('D', iso)
    .query('UPDATE Tasks SET DueDate = @D WHERE Id = @Id');
}

// ── test suite ────────────────────────────────────────────────────────────────

// File-scope lifecycle (hoisted above both describe blocks per the repo's
// multi-describe integration convention) — one truncate per test, one pool close.
beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

describe('ViewService.capacity — integration', () => {

  // Shared setup helper: one workspace + two assignees, each with tasks in
  // [2026-06-01, 2026-06-05].  Alice has 6 tasks (8h each, 3 pts each);
  // Bob has 1 task (1h, 1 pt).
  async function seedTwoAssignees() {
    const alice = await createTestUser({ name: 'Alice' });
    const bob   = await createTestUser({ name: 'Bob' });
    const ws    = await createTestWorkspace(alice.accessToken);

    // Bob must be invited into Alice's workspace so the scope node resolves.
    await request(`/workspaces/${ws.Id}/members/by-email`, {
      method: 'POST',
      token: alice.accessToken,
      json: { email: bob.user.Email, role: 'MEMBER' },
    });

    const p = await createTestProject(ws.Id, alice.accessToken);
    const scopePath = `/${p.Id}/`;

    // Alice: 6 tasks, 8h each, 3 pts each, DueDate inside the range.
    const aliceTasks: string[] = [];
    for (let i = 0; i < 6; i++) {
      const t = await createTestTask(p.Id, ws.Id, alice.accessToken, { title: `alice-${i}` });
      await setTaskListPath(t.Id, scopePath);
      await setTimeEstimate(t.Id, 28_800); // 8h
      await setStoryPoints(t.Id, 3);
      await setDueDate(t.Id, '2026-06-03T10:00:00'); // mid-range
      await taskRepo.setAssignees(t.Id, [alice.user.Id]);
      aliceTasks.push(t.Id);
    }

    // Bob: 1 task, 1h, 1 pt, DueDate inside the range.
    const bobTask = await createTestTask(p.Id, ws.Id, alice.accessToken, { title: 'bob-0' });
    await setTaskListPath(bobTask.Id, scopePath);
    await setTimeEstimate(bobTask.Id, 3_600); // 1h
    await setStoryPoints(bobTask.Id, 1);
    await setDueDate(bobTask.Id, '2026-06-04T09:00:00'); // mid-range
    await taskRepo.setAssignees(bobTask.Id, [bob.user.Id]);

    return { alice, bob, ws, p };
  }

  // ── case 1: time metric, over-capacity flagged, over sorts first ────────────
  it('time metric: Alice is over-capacity and sorts first', async () => {
    const { alice, bob, ws, p } = await seedTwoAssignees();

    const res = await viewService.capacity(
      'SPACE',
      p.Id,
      {
        filter: { conjunction: 'AND', rules: [] },
        sort: [],
        capacityMetric: 'time',
        capacityPerDaySeconds: 28_800, // 8h/day
      } as any,
      { from: '2026-06-01', to: '2026-06-05' }, // 5-day range → 40h capacity per person
      ws.Id,
      alice.user.Id,
    );

    expect(res.metric).toBe('time');

    const aliceRow = res.rows.find((r) => r.userId.toLowerCase() === alice.user.Id.toLowerCase());
    const bobRow   = res.rows.find((r) => r.userId.toLowerCase() === bob.user.Id.toLowerCase());

    expect(aliceRow, 'Alice row must be present').toBeDefined();
    expect(bobRow,   'Bob row must be present').toBeDefined();

    // Alice: 6 × 8h = 48h seconds
    expect(aliceRow!.assignedSeconds).toBe(6 * 28_800);
    // 48h > 40h capacity (5 days × 8h) → over
    expect(aliceRow!.status).toBe('over');

    // Bob: 1 × 1h = 1h → well under 40h
    expect(bobRow!.status).toBe('under');

    // Over-loaded assignee must sort first (descending ratio)
    expect(res.rows[0]!.userId.toLowerCase()).toBe(alice.user.Id.toLowerCase());
  });

  // ── case 2: points metric, over-capacity flagged ────────────────────────────
  it('points metric: Alice is over sprint points and sorts first', async () => {
    const { alice, bob, ws, p } = await seedTwoAssignees();

    const res = await viewService.capacity(
      'SPACE',
      p.Id,
      {
        filter: { conjunction: 'AND', rules: [] },
        sort: [],
        capacityMetric: 'points',
        capacityPerSprintPoints: 8,
      } as any,
      { from: null, to: null }, // unbounded — include all tasks
      ws.Id,
      alice.user.Id,
    );

    expect(res.metric).toBe('points');

    const aliceRow = res.rows.find((r) => r.userId.toLowerCase() === alice.user.Id.toLowerCase());
    expect(aliceRow, 'Alice row must be present').toBeDefined();

    // Alice: 6 × 3 pts = 18 pts
    expect(aliceRow!.assignedPoints).toBe(18);
    // 18 > 8 capacity → over
    expect(aliceRow!.status).toBe('over');

    // Over-loaded assignee must sort first
    expect(res.rows[0]!.userId.toLowerCase()).toBe(alice.user.Id.toLowerCase());
  });

  // ── case 3: out-of-range date filter excludes all tasks ─────────────────────
  it('out-of-range filter: no tasks due in July → rows are empty (or sums are 0)', async () => {
    const { alice, ws, p } = await seedTwoAssignees();

    const res = await viewService.capacity(
      'SPACE',
      p.Id,
      {
        filter: { conjunction: 'AND', rules: [] },
        sort: [],
        capacityMetric: 'time',
        capacityPerDaySeconds: 28_800,
      } as any,
      { from: '2026-07-01', to: '2026-07-31' }, // no tasks due in July
      ws.Id,
      alice.user.Id,
    );

    // The SQL JOIN produces no rows for dates outside the range, so the result
    // set should be empty OR Alice's sums should be 0.
    const aliceRow = res.rows.find((r) => r.userId.toLowerCase() === alice.user.Id.toLowerCase());
    if (aliceRow) {
      expect(aliceRow.assignedSeconds).toBe(0);
      expect(aliceRow.assignedPoints).toBe(0);
    } else {
      // Preferred: no row at all when there are no in-range tasks.
      expect(res.rows).toHaveLength(0);
    }
  });

  // ── case 4: DATETIME2 upper-bound inclusivity (Task 3 regression guard) ─────
  //
  // DueDate = '2026-06-05T15:30:00' (afternoon on the `to` day).
  // A plain `<= '2026-06-05'` DATETIME2 comparison would WRONGLY exclude this
  // task because '2026-06-05T15:30:00' > '2026-06-05T00:00:00'.
  // The correct predicate is `< DATEADD(DAY, 1, @__capTo)` (half-open).
  it('DATETIME2 upper-bound: afternoon task on the last day IS counted', async () => {
    const owner = await createTestUser({ name: 'Owner' });
    const ws    = await createTestWorkspace(owner.accessToken);
    const p     = await createTestProject(ws.Id, owner.accessToken);
    const scopePath = `/${p.Id}/`;

    const task = await createTestTask(p.Id, ws.Id, owner.accessToken, { title: 'afternoon-task' });
    await setTaskListPath(task.Id, scopePath);
    await setTimeEstimate(task.Id, 3_600); // 1h
    // Afternoon time on the boundary date — the critical value.
    await setDueDate(task.Id, '2026-06-05T15:30:00');
    await taskRepo.setAssignees(task.Id, [owner.user.Id]);

    const res = await viewService.capacity(
      'SPACE',
      p.Id,
      {
        filter: { conjunction: 'AND', rules: [] },
        sort: [],
        capacityMetric: 'time',
        capacityPerDaySeconds: 28_800,
      } as any,
      { from: '2026-06-01', to: '2026-06-05' }, // `to` is the boundary date
      ws.Id,
      owner.user.Id,
    );

    const ownerRow = res.rows.find((r) => r.userId.toLowerCase() === owner.user.Id.toLowerCase());
    expect(ownerRow, 'Owner row must appear — afternoon task IS in range').toBeDefined();
    expect(ownerRow!.assignedSeconds).toBe(3_600);
    expect(ownerRow!.taskCount).toBe(1);
  });
});

// ── negative-authz: route-level (GET /views/capacity) ────────────────────────

describe('GET /views/capacity — negative-authz', () => {

  const emptyConfig = JSON.stringify({
    filter: { conjunction: 'AND', rules: [] },
    sort: [],
    capacityMetric: 'time',
    capacityPerDaySeconds: 28800,
  });

  it('non-member user → 403 for a SPACE scope they cannot see', async () => {
    const owner    = await createTestUser();
    const outsider = await createTestUser();
    const ws = await createTestWorkspace(owner.accessToken);
    const p  = await createTestProject(ws.Id, owner.accessToken);

    const res = await request(
      `/views/capacity?scopeType=SPACE&scopeId=${p.Id}&config=${encodeURIComponent(emptyConfig)}&from=2026-06-01&to=2026-06-05`,
      { token: outsider.accessToken },
    );
    // A non-member has no ACL entry on the scope → 403 (no access) or 404
    // (scope not found for this user). Both are acceptable; what matters is
    // that the outsider is denied.
    expect([403, 404]).toContain(res.status);
  });

  it('non-existent scopeId → 404', async () => {
    const user = await createTestUser();
    const nonExistentId = randomUUID();

    const res = await request(
      `/views/capacity?scopeType=SPACE&scopeId=${nonExistentId}&config=${encodeURIComponent(emptyConfig)}&from=2026-06-01&to=2026-06-05`,
      { token: user.accessToken },
    );
    expect(res.status).toBe(404);
  });

  it('unauthenticated request → 401', async () => {
    const user = await createTestUser();
    const ws   = await createTestWorkspace(user.accessToken);
    const p    = await createTestProject(ws.Id, user.accessToken);

    const res = await request(
      `/views/capacity?scopeType=SPACE&scopeId=${p.Id}&config=${encodeURIComponent(emptyConfig)}&from=2026-06-01&to=2026-06-05`,
      // No token
    );
    expect(res.status).toBe(401);
  });
});
