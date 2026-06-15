import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { request } from '../../../__tests__/setup/testServer.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { closePool } from '../../../shared/lib/db.js';

interface GqlResult { data?: Record<string, any> | null; errors?: { message: string; extensions?: { code?: string } }[] }

async function gql(token: string, query: string, variables: Record<string, unknown>): Promise<GqlResult> {
  const res = await request('/graphql', { method: 'POST', token, json: { query, variables } });
  return (await res.json()) as GqlResult;
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
