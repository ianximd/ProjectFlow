/**
 * AiRepository — writes gateway audit rows to dbo.AiRuns.
 *
 * Columns from migration 0063:
 *   WorkspaceId, UserId, Feature, Provider, Model (nullable),
 *   Status, PromptTokens, CompletionTokens, LatencyMs, Error (nullable).
 *   Id + CreatedAt default server-side.
 *
 * Uses a parameterized INSERT (not a stored procedure) because AiRuns is a
 * simple append-only audit table with no business logic in the DB layer.
 */

import sql from 'mssql';
import { getPool } from '../../shared/lib/db.js';
import type { AiFeature } from './gateway/provider.types.js';

export interface AiRunRow {
  workspaceId: string;
  userId: string;
  feature: AiFeature;
  provider: string;
  model?: string | null;
  status: 'ok' | 'error' | 'refused';
  promptTokens?: number | null;
  completionTokens?: number | null;
  latencyMs?: number | null;
  error?: string | null;
}

export class AiRepository {
  async recordRun(row: AiRunRow): Promise<void> {
    const pool = await getPool();
    await pool
      .request()
      .input('WorkspaceId',      sql.UniqueIdentifier, row.workspaceId)
      .input('UserId',           sql.UniqueIdentifier, row.userId)
      .input('Feature',          sql.NVarChar(20),     row.feature)
      .input('Provider',         sql.NVarChar(40),     row.provider ?? null)
      .input('Model',            sql.NVarChar(60),     row.model ?? null)
      .input('Status',           sql.NVarChar(10),     row.status)
      .input('PromptTokens',     sql.Int,              row.promptTokens ?? null)
      .input('CompletionTokens', sql.Int,              row.completionTokens ?? null)
      .input('LatencyMs',        sql.Int,              row.latencyMs ?? null)
      .input('Error',            sql.NVarChar(sql.MAX), row.error ?? null)
      .query(`
        INSERT INTO dbo.AiRuns
          (WorkspaceId, UserId, Feature, Provider, Model,
           Status, PromptTokens, CompletionTokens, LatencyMs, Error)
        VALUES
          (@WorkspaceId, @UserId, @Feature, @Provider, @Model,
           @Status, @PromptTokens, @CompletionTokens, @LatencyMs, @Error)
      `);
  }
}
