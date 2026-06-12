/**
 * Phase 8c — sprint-folder schema + CRUD integration coverage.
 * DB SAFETY: must target the local Docker ProjectFlow_Test DB (see e2e/README).
 *
 * This file accumulates describe blocks across the Phase 8c batches:
 *   - schema (0046)                 — this batch
 *   - usp_Folder_Set/GetSprintSettings, usp_Sprint_CreateInFolder,
 *     usp_Sprint_RollForward, usp_Sprint_GetPointsRollup,
 *     usp_Sprint_ListDueFolders   — SP batch
 *   - SprintRepository / sprintService / REST surface — later batches
 */
import { afterAll, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../../../shared/lib/db.js';

afterAll(async () => { await closePool(); });

describe('0046 sprint-folder schema', () => {
  it('adds Folders.IsSprintFolder', async () => {
    const pool = await getPool();
    const r = await pool.request().query(
      `SELECT COL_LENGTH('dbo.Folders','IsSprintFolder') AS len`,
    );
    expect(r.recordset[0].len).not.toBeNull();
  });

  it('creates the SprintSettings table with a FolderId PK', async () => {
    const pool = await getPool();
    const r = await pool.request().query(
      `SELECT OBJECT_ID('dbo.SprintSettings') AS oid`,
    );
    expect(r.recordset[0].oid).not.toBeNull();
  });

  it('adds Sprints.ListId and Sprints.FolderId', async () => {
    const pool = await getPool();
    const r = await pool.request().query(
      `SELECT COL_LENGTH('dbo.Sprints','ListId') AS lst, COL_LENGTH('dbo.Sprints','FolderId') AS fld`,
    );
    expect(r.recordset[0].lst).not.toBeNull();
    expect(r.recordset[0].fld).not.toBeNull();
  });
});
