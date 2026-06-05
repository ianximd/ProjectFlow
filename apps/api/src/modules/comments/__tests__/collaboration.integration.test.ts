/**
 * Collaboration depth — DB-backed integration coverage (Phase 3.5a, Batch E).
 *
 * Exercises the comment side-effect pipeline end-to-end against a real SQL
 * Server: mentions (notify + auto-watch, idempotent on edit, non-member skip),
 * fan-out (watcher + reporter paths), and comment assign/resolve.
 *
 * IMPORTANT — the comment service fires its side-effects fire-and-forget
 * (`void (async () => {...})()`), so the notification/watcher rows land AFTER
 * the HTTP response returns. Every assertion that observes a side-effect polls
 * with a short retry budget instead of reading once.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

const eq = (a?: string | null, b?: string | null) =>
  String(a ?? '').toUpperCase() === String(b ?? '').toUpperCase();

/** Poll `fn` until it returns truthy or the budget elapses. */
async function eventually<T>(fn: () => Promise<T>, { tries = 30, delayMs = 100 } = {}): Promise<T> {
  let last: T = undefined as unknown as T;
  for (let i = 0; i < tries; i += 1) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return last;
}

/** All notifications for a user (camelCase: { id, userId, type, payload, ... }). */
async function listNotifications(token: string): Promise<Array<{ type: string; payload: any }>> {
  const res = await request('/notifications?pageSize=50', { token });
  const body = await json<{ data: Array<{ type: string; payload: any }> }>(res, 200);
  return body.data;
}

/** Count notifications of a given type for a user, polling until >= want (or budget). */
async function notifCount(token: string, type: string): Promise<number> {
  const list = await listNotifications(token);
  return list.filter((n) => n.type === type).length;
}

/** Wait until the user has >= `want` notifications of `type`; returns the final count. */
async function waitNotif(token: string, type: string, want = 1): Promise<number> {
  return eventually(async () => {
    const n = await notifCount(token, type);
    return n >= want ? n : 0;
  }) || (await notifCount(token, type));
}

/** Task watcher user-ids (watcher rows expose { userId }). */
async function watcherIds(taskId: string, token: string): Promise<string[]> {
  const res = await request(`/tasks/${taskId}/watchers`, { token });
  const body = await json<{ data: Array<{ userId?: string; UserId?: string }> }>(res, 200);
  return body.data.map((w) => (w.userId ?? w.UserId)!).filter(Boolean);
}

async function isWatching(taskId: string, token: string, userId: string): Promise<boolean> {
  const got = await eventually(async () => {
    const ids = await watcherIds(taskId, token);
    return ids.some((id) => eq(id, userId)) ? ids : null;
  });
  return Boolean(got);
}

async function postComment(token: string, taskId: string, body: string) {
  const res = await request('/comments', { method: 'POST', token, json: { taskId, body } });
  return json<{ data: any }>(res, 201).then((b) => b.data);
}

/**
 * Workspace owner + one workspace member + a project (Space) + a List + a task
 * reported by owner. Reporter is always the task creator (the route forces
 * reporterId = actor), so `owner` is the task's reporter.
 *
 * The task is created inside an explicit List because the watcher VIEW route
 * (GET /tasks/:id/watchers) resolves object access against the task's List —
 * a task created with only a projectId has no List and that read 404s.
 */
async function seedTaskWithMember() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const owner  = await createTestUser({ email: `c-owner-${stamp}@projectflow.test` });
  const member = await createTestUser({ email: `c-mem-${stamp}@projectflow.test` });
  const ws = await createTestWorkspace(owner.accessToken);
  // Invite by internal userId (route shape: { userId, role: 'MEMBER'|'ADMIN'|'VIEWER' }).
  await json(await request(`/workspaces/${ws.Id}/members`, {
    method: 'POST', token: owner.accessToken, json: { userId: member.user.Id, role: 'MEMBER' },
  }), 201);
  const project = await createTestProject(ws.Id, owner.accessToken, { name: 'P', key: `CB${Date.now() % 100000}` });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token: owner.accessToken,
    json: { workspaceId: ws.Id, spaceId: project.Id, folderId: null, name: 'Default', position: 0 },
  }), 201)).data;
  const task = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token: owner.accessToken,
    json: { workspaceId: ws.Id, listId: list.id ?? list.Id, title: 'Collab task' },
  }), 201)).data;
  return { owner, member, ws, project, list, task, taskId: task.Id ?? task.id };
}

describe('collaboration — mentions', () => {
  it('mentioning a member notifies them and auto-watches them on the task', async () => {
    const { owner, member, taskId } = await seedTaskWithMember();
    await postComment(owner.accessToken, taskId, `Hello @[Member](${member.user.Id}) please look`);

    expect(await waitNotif(member.accessToken, 'MENTION', 1)).toBeGreaterThanOrEqual(1);
    expect(await isWatching(taskId, owner.accessToken, member.user.Id)).toBe(true);
  });

  it('does not re-notify an already-mentioned member on edit', async () => {
    const { owner, member, taskId } = await seedTaskWithMember();
    const comment = await postComment(owner.accessToken, taskId, `Hi @[Member](${member.user.Id})`);
    expect(await waitNotif(member.accessToken, 'MENTION', 1)).toBe(1);

    // Edit, still mentioning the same member — must NOT produce a second MENTION.
    await json(await request(`/comments/${comment.id}`, {
      method: 'PATCH', token: owner.accessToken,
      json: { body: `Hi again @[Member](${member.user.Id})` },
    }), 200);

    // Give any (erroneous) second notification time to land, then assert exactly one.
    await new Promise((r) => setTimeout(r, 600));
    expect(await notifCount(member.accessToken, 'MENTION')).toBe(1);
  });

  it('silently skips mentioning a non-workspace-member (no notification)', async () => {
    const { owner, taskId } = await seedTaskWithMember();
    const stranger = await createTestUser({ email: `c-stranger-${Date.now()}@projectflow.test` });
    await postComment(owner.accessToken, taskId, `Hey @[Stranger](${stranger.user.Id})`);

    // Let the side-effect pipeline run, then confirm the stranger got nothing.
    await new Promise((r) => setTimeout(r, 600));
    expect(await notifCount(stranger.accessToken, 'MENTION')).toBe(0);
  });
});

describe('collaboration — fan-out', () => {
  it('notifies an existing watcher of a new comment and auto-watches the author', async () => {
    const { owner, member, taskId } = await seedTaskWithMember();
    // Make member a watcher first (owner has task.update).
    await json(await request(`/tasks/${taskId}/watchers/${member.user.Id}`, {
      method: 'POST', token: owner.accessToken,
    }), 200);

    await postComment(owner.accessToken, taskId, 'A plain comment, no mentions');

    expect(await waitNotif(member.accessToken, 'COMMENT_ADDED', 1)).toBeGreaterThanOrEqual(1);
    // Author (owner) auto-watches on comment.
    expect(await isWatching(taskId, owner.accessToken, owner.user.Id)).toBe(true);
  });

  it('notifies the task reporter when a different member comments (reporter fan-out)', async () => {
    // owner is the reporter (created the task); member — neither reporter nor a
    // pre-existing watcher — posts a plain comment. The reporter must be reached.
    const { owner, member, taskId } = await seedTaskWithMember();
    await postComment(member.accessToken, taskId, 'Comment from a non-reporter member');

    expect(await waitNotif(owner.accessToken, 'COMMENT_ADDED', 1)).toBeGreaterThanOrEqual(1);
  });
});

describe('collaboration — assign / resolve', () => {
  it('assigns a comment to a member, who is notified (COMMENT_ASSIGNED)', async () => {
    const { owner, member, taskId } = await seedTaskWithMember();
    const comment = await postComment(owner.accessToken, taskId, 'Needs follow-up');

    const res = await request(`/comments/${comment.id}/assign`, {
      method: 'POST', token: owner.accessToken, json: { assigneeId: member.user.Id },
    });
    const body = await json<{ data: any }>(res, 200);
    expect(eq(body.data.assignedToId, member.user.Id)).toBe(true);

    expect(await waitNotif(member.accessToken, 'COMMENT_ASSIGNED', 1)).toBeGreaterThanOrEqual(1);
  });

  it('rejects assigning to a non-workspace-member with 422', async () => {
    const { owner, taskId } = await seedTaskWithMember();
    const comment = await postComment(owner.accessToken, taskId, 'Try to assign an outsider');
    const stranger = await createTestUser({ email: `c-asg-out-${Date.now()}@projectflow.test` });

    const res = await request(`/comments/${comment.id}/assign`, {
      method: 'POST', token: owner.accessToken, json: { assigneeId: stranger.user.Id },
    });
    expect(res.status).toBe(422);
  });

  it('toggles resolved on and off', async () => {
    const { owner, taskId } = await seedTaskWithMember();
    const comment = await postComment(owner.accessToken, taskId, 'Resolve me');

    const resolved = await json<{ data: any }>(await request(`/comments/${comment.id}/resolve`, {
      method: 'POST', token: owner.accessToken, json: { resolved: true },
    }), 200);
    expect(resolved.data.resolvedAt).toBeTruthy();

    const reopened = await json<{ data: any }>(await request(`/comments/${comment.id}/resolve`, {
      method: 'POST', token: owner.accessToken, json: { resolved: false },
    }), 200);
    expect(reopened.data.resolvedAt).toBeFalsy();
  });
});
