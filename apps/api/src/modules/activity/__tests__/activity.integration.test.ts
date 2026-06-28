import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { closePool } from '../../../shared/lib/db.js';
import { activityService } from '../activity.service.js';
import { adminRepository } from '../../admin/admin.repository.js';

interface GqlResult { data?: Record<string, any> | null; errors?: { message: string; extensions?: { code?: string } }[] }

async function gql(token: string, query: string, variables: Record<string, unknown>): Promise<GqlResult> {
  const res = await request('/graphql', { method: 'POST', token, json: { query, variables } });
  return (await res.json()) as GqlResult;
}

/**
 * Seeds a task inside a List, in a workspace with an owner (member) and a
 * stranger (not in the workspace), then writes a Task UPDATE audit row with
 * resourceId = task.id EXACTLY the way production does: with WorkspaceId = NULL.
 *
 * The request-audit middleware (audit.middleware.ts) logs every task write via
 * adminService.log WITHOUT a workspaceId, so real Task audit rows always have
 * WorkspaceId NULL. We seed the row directly through adminRepository (the same
 * SP path the middleware uses) — and crucially WITHOUT a workspaceId — so the
 * test exercises the production row shape. We write it synchronously (the
 * middleware path is fire-and-forget) so the assertion is deterministic.
 */
async function seedTaskWithAudit() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const owner    = await createTestUser({ email: `ta-owner-${stamp}@projectflow.test` });
  const outsider = await createTestUser({ email: `ta-out-${stamp}@projectflow.test` });
  const ws = await createTestWorkspace(owner.accessToken);

  const keySuffix = stamp.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase();
  const project = await createTestProject(ws.Id, owner.accessToken, { name: 'TaskActivity', key: `TA${keySuffix}` });

  // Create a list inside the space
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token: owner.accessToken,
    json: { workspaceId: ws.Id, spaceId: project.Id, folderId: null, name: 'Default', position: 0 },
  }), 201)).data;
  const listId = list.id ?? list.Id;

  // Create a task inside the list
  const task = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token: owner.accessToken,
    json: { workspaceId: ws.Id, listId, title: 'Audit seed task' },
  }), 201)).data;
  const taskId = task.Id ?? task.id;

  // Seed the Task UPDATE audit row the way PRODUCTION writes it: WorkspaceId
  // OMITTED → stored as NULL. This is the row shape that a workspace-scoped
  // filter would wrongly exclude.
  await adminRepository.createAuditEntry({
    // workspaceId intentionally omitted (→ NULL), matching audit.middleware
    userId:     owner.user.Id,
    userEmail:  owner.user.Email,
    action:     'UPDATE',
    resource:   'Task',
    resourceId: taskId,
  });

  // memberCtx / outsiderCtx — thin objects that match what activityService expects
  const memberCtx  = { user: { userId: owner.user.Id } };
  const outsiderCtx = { user: { userId: outsider.user.Id } };

  return { task: { id: taskId, listId, workspaceId: ws.Id }, memberCtx, outsiderCtx };
}

const ACTIVITY_QUERY = `
  query ActivityFeed($scopeType: String!, $scopeId: String, $workspaceId: String) {
    activityFeed(scopeType: $scopeType, scopeId: $scopeId, workspaceId: $workspaceId, page: 1, pageSize: 25) {
      total
      page
      pageSize
      entries {
        id
        action
        resource
        userId
        createdAt
      }
    }
  }
`;

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

describe('taskActivity', () => {
  it('returns audit rows for the task and enforces LIST VIEW authz', async () => {
    const { task, memberCtx, outsiderCtx } = await seedTaskWithAudit();

    // Member sees the task's audit row. This row has WorkspaceId=NULL (the
    // production shape), so a workspace-scoped filter would wrongly exclude it
    // and this assertion would FAIL — this is the regression guard for the
    // task-scoped feed correctness bug.
    const page = await activityService.getTaskActivity(
      memberCtx.user.userId, task.id, { page: 1, pageSize: 50 },
    );
    expect(page.entries.some((e) => e.resourceId === task.id)).toBe(true);

    // Outsider (not a workspace member) must be FORBIDDEN
    await expect(
      activityService.getTaskActivity(outsiderCtx.user.userId, task.id, {}),
    ).rejects.toThrow(/forbidden/i);
  });

  it('throws NOT_FOUND for a missing task', async () => {
    await expect(
      activityService.getTaskActivity(
        '00000000-0000-0000-0000-000000000000',
        '11111111-1111-1111-1111-111111111111',
        {},
      ),
    ).rejects.toThrow(/not found/i);
  });
});

describe('activityFeed GraphQL', () => {
  it('returns an AuditLogPage for an EVERYTHING-scoped query (workspace owner)', async () => {
    const u  = await createTestUser({ email: `af-owner-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(u.accessToken);

    const result = await gql(u.accessToken, ACTIVITY_QUERY, {
      scopeType:   'EVERYTHING',
      workspaceId: ws.Id,
    });

    expect(result.errors, JSON.stringify(result)).toBeUndefined();
    const feed = result.data!.activityFeed;
    expect(feed).toBeDefined();
    expect(typeof feed.total).toBe('number');
    expect(feed.page).toBe(1);
    expect(feed.pageSize).toBe(25);
    expect(Array.isArray(feed.entries)).toBe(true);
  });

  it('returns FORBIDDEN for a non-member on EVERYTHING scope', async () => {
    const owner   = await createTestUser({ email: `af-owner2-${Date.now()}@projectflow.test` });
    const ws      = await createTestWorkspace(owner.accessToken);
    const stranger = await createTestUser({ email: `af-stranger-${Date.now()}@projectflow.test` });

    const result = await gql(stranger.accessToken, ACTIVITY_QUERY, {
      scopeType:   'EVERYTHING',
      workspaceId: ws.Id,
    });

    expect(result.errors).toBeDefined();
    const code = result.errors![0]?.extensions?.code;
    expect(code === 'FORBIDDEN' || code === 'NOT_FOUND').toBe(true);
  });

  it('returns UNAUTHENTICATED when no token is provided', async () => {
    const owner = await createTestUser({ email: `af-noauth-${Date.now()}@projectflow.test` });
    const ws    = await createTestWorkspace(owner.accessToken);

    // Pass an empty token so the request is unauthenticated
    const result = await gql('', ACTIVITY_QUERY, {
      scopeType:   'EVERYTHING',
      workspaceId: ws.Id,
    });

    expect(result.errors).toBeDefined();
    const code = result.errors![0]?.extensions?.code;
    expect(code === 'UNAUTHENTICATED' || code === 'FORBIDDEN').toBe(true);
  });
});
