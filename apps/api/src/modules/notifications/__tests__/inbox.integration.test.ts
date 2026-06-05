/**
 * Inbox backend integration tests (Phase 3.5c, Task 10).
 *
 * Exercises C2/C3 inbox endpoints against a real SQL Server (ProjectFlow_Test):
 *   1. type filter  — GET /notifications?types=MENTION returns only MENTION rows
 *   2. save round-trip — PATCH /notifications/:id/saved { saved:true } then false
 *   3. cross-user 404 — user B cannot saved-toggle a notification owned by user A
 *
 * Notifications are seeded via the live comment pipeline (Phase 3.5a), which
 * is fire-and-forget, so every assertion that observes a side-effect polls with
 * `eventually` / `waitNotif`.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

// ─── helpers ───────────────────────────────────────────────────────────────

const eq = (a?: string | null, b?: string | null) =>
  String(a ?? '').toUpperCase() === String(b ?? '').toUpperCase();

async function eventually<T>(
  fn: () => Promise<T>,
  { tries = 30, delayMs = 150 } = {},
): Promise<T> {
  let last: T = undefined as unknown as T;
  for (let i = 0; i < tries; i += 1) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return last;
}

interface NotifRow {
  id: string;
  type: string;
  payload: any;
  isRead: boolean;
  savedForLater: boolean;
  savedAt: string | null;
  createdAt: string;
}

async function listNotifications(
  token: string,
  qs = '',
): Promise<NotifRow[]> {
  const res = await request(`/notifications?pageSize=50${qs ? `&${qs}` : ''}`, { token });
  const body = await json<{ data: NotifRow[] }>(res, 200);
  return body.data;
}

async function notifCount(token: string, type: string): Promise<number> {
  const list = await listNotifications(token);
  return list.filter((n) => n.type === type).length;
}

async function waitNotif(token: string, type: string, want = 1): Promise<number> {
  return (
    (await eventually(async () => {
      const n = await notifCount(token, type);
      return n >= want ? n : 0;
    })) || (await notifCount(token, type))
  );
}

async function postComment(token: string, taskId: string, body: string) {
  const res = await request('/comments', { method: 'POST', token, json: { taskId, body } });
  return json<{ data: any }>(res, 201).then((b) => b.data);
}

/**
 * Minimal seed: owner + member, workspace, project, list, task.
 * Mirrors the pattern from collaboration.integration.test.ts exactly.
 */
async function seedTaskWithMember() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const owner  = await createTestUser({ email: `ib-owner-${stamp}@projectflow.test` });
  const member = await createTestUser({ email: `ib-mem-${stamp}@projectflow.test` });
  const ws = await createTestWorkspace(owner.accessToken);
  await json(
    await request(`/workspaces/${ws.Id}/members`, {
      method: 'POST', token: owner.accessToken,
      json: { userId: member.user.Id, role: 'MEMBER' },
    }),
    201,
  );
  const keySuffix = stamp.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase();
  const project = await createTestProject(ws.Id, owner.accessToken, {
    name: 'InboxP', key: `IB${keySuffix}`,
  });
  const list = (
    await json<{ data: any }>(
      await request('/lists', {
        method: 'POST', token: owner.accessToken,
        json: { workspaceId: ws.Id, spaceId: project.Id, folderId: null, name: 'Default', position: 0 },
      }),
      201,
    )
  ).data;
  const task = (
    await json<{ data: any }>(
      await request('/tasks', {
        method: 'POST', token: owner.accessToken,
        json: { workspaceId: ws.Id, listId: list.id ?? list.Id, title: 'Inbox task' },
      }),
      201,
    )
  ).data;
  return { owner, member, ws, project, list, task, taskId: task.Id ?? task.id };
}

// ─── tests ─────────────────────────────────────────────────────────────────

describe('inbox — type filter', () => {
  it('GET ?types=MENTION returns only MENTION rows (excludes COMMENT_ADDED)', async () => {
    const { owner, member, taskId } = await seedTaskWithMember();

    // Seed a MENTION for member.
    await postComment(
      owner.accessToken,
      taskId,
      `Hey @[Member](${member.user.Id}) take a look`,
    );
    // Wait until the MENTION notification has landed (fire-and-forget).
    expect(await waitNotif(member.accessToken, 'MENTION', 1)).toBeGreaterThanOrEqual(1);

    // Seed a COMMENT_ADDED for member by adding member as a watcher then posting
    // a plain comment (no mention).
    await json(
      await request(`/tasks/${taskId}/watchers/${member.user.Id}`, {
        method: 'POST', token: owner.accessToken,
      }),
      200,
    );
    await postComment(owner.accessToken, taskId, 'A plain follow-up with no mentions');
    // Wait for the COMMENT_ADDED to land so we know it's in the DB.
    expect(await waitNotif(member.accessToken, 'COMMENT_ADDED', 1)).toBeGreaterThanOrEqual(1);

    // Now filter by MENTION only — must not include COMMENT_ADDED rows.
    const filtered = await listNotifications(member.accessToken, 'types=MENTION');
    expect(filtered.length).toBeGreaterThanOrEqual(1);
    for (const n of filtered) {
      expect(n.type).toBe('MENTION');
    }
    // COMMENT_ADDED must be absent from the filtered list.
    expect(filtered.some((n) => n.type === 'COMMENT_ADDED')).toBe(false);
  });
});

describe('inbox — save round-trip', () => {
  it('PATCH /saved true marks savedForLater; false unmarks; savedOnly filter is consistent', async () => {
    const { owner, member, taskId } = await seedTaskWithMember();

    // Seed a MENTION so there is at least one notification for member.
    await postComment(
      owner.accessToken,
      taskId,
      `Save this @[Member](${member.user.Id})`,
    );
    expect(await waitNotif(member.accessToken, 'MENTION', 1)).toBeGreaterThanOrEqual(1);

    // Grab the notification id.
    const all = await listNotifications(member.accessToken);
    const notif = all.find((n) => n.type === 'MENTION');
    expect(notif).toBeDefined();
    const notifId = notif!.id;

    // ── mark saved ──────────────────────────────────────────────────────────
    const saveRes = await request(`/notifications/${notifId}/saved`, {
      method: 'PATCH', token: member.accessToken, json: { saved: true },
    });
    expect(saveRes.status).toBe(204);

    // GET ?savedOnly=true must now include this notification.
    const savedList = await listNotifications(member.accessToken, 'savedOnly=true');
    const savedRow = savedList.find((n) => eq(n.id, notifId));
    expect(savedRow).toBeDefined();
    expect(savedRow!.savedForLater).toBe(true);

    // ── unmark saved ────────────────────────────────────────────────────────
    const unsaveRes = await request(`/notifications/${notifId}/saved`, {
      method: 'PATCH', token: member.accessToken, json: { saved: false },
    });
    expect(unsaveRes.status).toBe(204);

    // GET ?savedOnly=true must no longer include this notification.
    const unsavedList = await listNotifications(member.accessToken, 'savedOnly=true');
    expect(unsavedList.some((n) => eq(n.id, notifId))).toBe(false);
  });
});

describe('inbox — cross-user isolation (tenant guard)', () => {
  it('user B gets 404 when trying to saved-toggle a notification owned by user A', async () => {
    const { owner, member, taskId } = await seedTaskWithMember();

    // Seed a notification for owner (owner posts, member is a watcher, then
    // member posts a plain comment so owner gets COMMENT_ADDED as reporter).
    await json(
      await request(`/tasks/${taskId}/watchers/${member.user.Id}`, {
        method: 'POST', token: owner.accessToken,
      }),
      200,
    );
    await postComment(member.accessToken, taskId, 'Comment from member — owner should get notified');
    expect(await waitNotif(owner.accessToken, 'COMMENT_ADDED', 1)).toBeGreaterThanOrEqual(1);

    // Capture a notification ID that belongs to owner.
    const ownerNotifs = await listNotifications(owner.accessToken);
    expect(ownerNotifs.length).toBeGreaterThanOrEqual(1);
    const idForOwner = ownerNotifs[0]!.id;

    // A completely unrelated user (not even in the workspace) tries to toggle it.
    const stranger = await createTestUser({
      email: `ib-stranger-${Date.now()}@projectflow.test`,
    });

    const res = await request(`/notifications/${idForOwner}/saved`, {
      method: 'PATCH', token: stranger.accessToken, json: { saved: true },
    });
    // Must be 404 — the route must not reveal the existence of another user's notification.
    expect(res.status).toBe(404);
  });
});
