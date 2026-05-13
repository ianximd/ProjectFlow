/**
 * End-to-end proof that the audit middleware now records field-level
 * diffs into `AuditLog.OldValues` / `NewValues` for resources with a
 * registered snapshot fetcher. Drives a real PATCH and a real DELETE
 * against the in-process Hono app, then reads the AuditLog rows back.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { closePool, getPool } from '../../lib/db.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace } from '../../../__tests__/fixtures/factories.js';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { registerAuditSnapshots } from '../audit-snapshots.bootstrap.js';

// The test runs in-process via `app.request()`, so server.ts's boot path
// never executes. Register snapshots once here.
registerAuditSnapshots();

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

async function readAuditRow(criteria: {
  resource: string;
  resourceId: string;
  action: string;
}): Promise<{ OldValues: any; NewValues: any; UserId: string } | null> {
  const pool = await getPool();
  // Audit writes are fire-and-forget; poll briefly.
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const r = await pool.request()
      .input('Resource',   sql.NVarChar(100), criteria.resource)
      .input('ResourceId', sql.NVarChar(255), criteria.resourceId)
      .input('Action',     sql.NVarChar(50),  criteria.action)
      .query(`
        SELECT TOP 1 OldValues, NewValues, UserId
        FROM   dbo.AuditLog
        WHERE  Resource   = @Resource
          AND  ResourceId = @ResourceId
          AND  Action     = @Action
        ORDER BY CreatedAt DESC
      `);
    if (r.recordset[0]) return r.recordset[0];
    await new Promise((res) => setTimeout(res, 50));
  }
  return null;
}

describe('audit middleware — field-level diff (Phase 6 W43)', () => {
  it('records OldValues + NewValues for a workspace name change', async () => {
    const owner = await createTestUser();
    const ws = await createTestWorkspace(owner.accessToken, 'Original Name');

    const patch = await request(`/workspaces/${ws.Id}`, {
      method: 'PATCH',
      token:  owner.accessToken,
      json:   { name: 'Renamed' },
    });
    await json(patch, 200);

    const row = await readAuditRow({
      resource: 'Workspace', resourceId: ws.Id, action: 'UPDATE',
    });
    expect(row).not.toBeNull();
    const oldValues = JSON.parse(row!.OldValues);
    const newValues = JSON.parse(row!.NewValues);
    // SP returns PascalCase columns (Name, Slug, Id, ...), and the diff
    // preserves the source casing rather than translating to JS-style.
    expect(oldValues.Name).toBe('Original Name');
    expect(newValues.Name).toBe('Renamed');
    // Unchanged keys are NOT in the diff.
    expect(oldValues.Id).toBeUndefined();
    expect(newValues.Slug).toBeUndefined();
  });

  it('records a DELETE with the full before-state as OldValues and NewValues null', async () => {
    const owner = await createTestUser();
    const ws    = await createTestWorkspace(owner.accessToken, 'To Delete');

    const del = await request(`/workspaces/${ws.Id}`, {
      method: 'DELETE',
      token:  owner.accessToken,
    });
    expect(del.status).toBe(204);

    const row = await readAuditRow({
      resource: 'Workspace', resourceId: ws.Id, action: 'DELETE',
    });
    expect(row).not.toBeNull();
    expect(row!.NewValues).toBeNull();
    const oldValues = JSON.parse(row!.OldValues);
    expect(oldValues.Name).toBe('To Delete');
    expect(oldValues.Id).toBe(ws.Id);
  });

  it('writes the audit row even when the diff is empty (UPDATE with no field changes)', async () => {
    // An UPDATE call that doesn't change any tracked column still produces
    // an audit row — operator wants the "Alice touched this workspace"
    // record even if no field-level diff fires. OldValues/NewValues are
    // null in that row, by design.
    const owner = await createTestUser();
    const ws    = await createTestWorkspace(owner.accessToken, 'Same Name');

    const patch = await request(`/workspaces/${ws.Id}`, {
      method: 'PATCH',
      token:  owner.accessToken,
      json:   { name: 'Same Name' },
    });
    await json(patch, 200);

    const row = await readAuditRow({
      resource: 'Workspace', resourceId: ws.Id, action: 'UPDATE',
    });
    expect(row).not.toBeNull();
    expect(row!.OldValues).toBeNull();
    expect(row!.NewValues).toBeNull();
  });
});
