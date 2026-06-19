/**
 * Integration test: AiGatewayService audit path.
 *
 * Verifies that a single gateway.complete() call with FakeProvider writes
 * EXACTLY ONE AiRuns row with the correct workspaceId, userId, feature,
 * provider, and status.
 *
 * Requires: ProjectFlow_Test SQL Server (local Docker).
 * Set env before running:
 *   $env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'
 *   $env:DB_USER='sa'; $env:DB_PASSWORD='YourStrong@Passw0rd'
 *   $env:DB_ENCRYPT='false'; $env:DB_TRUST_SERVER_CERTIFICATE='true'
 *   (ANTHROPIC_API_KEY must NOT be set — so makeProvider() picks FakeProvider)
 */

import { beforeEach, afterEach, afterAll, it, expect, describe } from 'vitest';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { getPool, closePool } from '../../../shared/lib/db.js';
import { AiGatewayService } from '../gateway/ai-gateway.service.js';
import { FakeProvider } from '../gateway/fake.provider.js';
import { AiRepository } from '../ai.repository.js';

// Use fresh GUIDs — AiRuns has no FK on WorkspaceId/UserId per migration 0063.
const WORKSPACE_ID = '11111111-0000-0000-0000-000000000001';
const USER_ID      = '22222222-0000-0000-0000-000000000002';

describe('AiGatewayService audit path (integration)', () => {
  // Capture the original value so parallel test runs can restore it correctly.
  let originalApiKey: string | undefined;

  beforeEach(async () => {
    originalApiKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    await truncateAll();
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
  });

  afterAll(async () => {
    await closePool();
  });

  it('complete() writes exactly one AiRuns row with correct fields', async () => {
    // Arrange: force FakeProvider regardless of env (key already deleted in beforeEach)
    const service = new AiGatewayService(new FakeProvider(), new AiRepository());

    // Act
    const result = await service.complete(
      { workspaceId: WORKSPACE_ID, userId: USER_ID, feature: 'search' },
      { prompt: 'what tasks are overdue?', sources: [] },
    );

    // Assert: result looks right
    expect(result.text).toBeTruthy();

    // Assert: exactly one AiRuns row
    const pool = await getPool();
    const rows = await pool.request().query<{
      WorkspaceId: string;
      UserId: string;
      Feature: string;
      Provider: string;
      Status: string;
      PromptTokens: number | null;
      CompletionTokens: number | null;
      LatencyMs: number | null;
    }>(`SELECT WorkspaceId, UserId, Feature, Provider, Status,
              PromptTokens, CompletionTokens, LatencyMs
         FROM dbo.AiRuns`);

    expect(rows.recordset).toHaveLength(1);

    const row = rows.recordset[0];
    expect(row.WorkspaceId.toLowerCase()).toBe(WORKSPACE_ID.toLowerCase());
    expect(row.UserId.toLowerCase()).toBe(USER_ID.toLowerCase());
    expect(row.Feature).toBe('search');
    expect(row.Provider).toBe('fake');
    expect(row.Status).toBe('ok');
    expect(row.PromptTokens).toBeGreaterThan(0);
    expect(row.CompletionTokens).toBeGreaterThan(0);
    expect(row.LatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('second call produces a second row (one row per call)', async () => {
    const service = new AiGatewayService(new FakeProvider(), new AiRepository());

    await service.complete(
      { workspaceId: WORKSPACE_ID, userId: USER_ID, feature: 'search' },
      { prompt: 'first call' },
    );
    await service.complete(
      { workspaceId: WORKSPACE_ID, userId: USER_ID, feature: 'qa' },
      { prompt: 'second call' },
    );

    const pool = await getPool();
    const rows = await pool.request().query(`SELECT COUNT(*) AS cnt FROM dbo.AiRuns`);
    expect(rows.recordset[0].cnt).toBe(2);
  });

  it('failed provider call writes status=error row and rethrows', async () => {
    const boom = new Error('provider exploded');
    const failProvider = {
      name: 'fake',
      complete: async () => { throw boom; },
      completeStructured: async () => { throw boom; },
      stream: async function* () { throw boom; },
    };

    const service = new AiGatewayService(failProvider as any, new AiRepository());

    await expect(
      service.complete(
        { workspaceId: WORKSPACE_ID, userId: USER_ID, feature: 'qa' },
        { prompt: 'will fail' },
      ),
    ).rejects.toThrow('provider exploded');

    const pool = await getPool();
    const rows = await pool.request().query<{ Status: string; Error: string }>(
      `SELECT Status, Error FROM dbo.AiRuns`,
    );
    expect(rows.recordset).toHaveLength(1);
    expect(rows.recordset[0].Status).toBe('error');
    expect(rows.recordset[0].Error).toContain('provider exploded');
  });
});
