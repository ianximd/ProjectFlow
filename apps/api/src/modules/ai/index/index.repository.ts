/**
 * IndexRepository — read/write access to dbo.AiChunks for the indexing pipeline
 * and hybrid retrieval (Phase 11a).
 *
 * Write path (driven by ai-index.worker):
 *   - upsertChunks: delete the object's LIVE chunks, insert the fresh rows.
 *   - softDeleteByObject: tombstone the object's live chunks.
 *
 * Read path (candidate generation for hybrid retrieval):
 *   - keywordCandidates: LIKE-based term matching, ACL-pre-filtered.
 *   - semanticCandidates: brute-force cosine vs the query vector, ACL-pre-filtered.
 *   - loadChunks: hydrate full rows by id.
 *
 * Every read JOINs dbo.usp_AccessibleScopes_ForUser(@UserId,@WorkspaceId) so a
 * caller only ever sees chunks under scopes they can VIEW — the SP is the single
 * source of truth for ACL (mirrors usp_ObjectAccess_Resolve set-wise).
 */

import sql from 'mssql';
import { getPool } from '../../../shared/lib/db.js';

export type AiObjectType = 'task' | 'doc' | 'comment';
export type AiScopeType = 'SPACE' | 'FOLDER' | 'LIST';

/** A chunk row to persist. Embedding is the raw model vector (or null). */
export interface ChunkInsert {
  workspaceId: string;
  objectType: AiObjectType;
  objectId: string;
  scopeType: AiScopeType;
  scopeId: string;
  listId: string | null;
  chunkSeq: number;
  content: string;
  embedding: Float32Array | null;
  embeddingModel: string | null;
  contentHash: string;
  tokenCount: number;
}

/** A live chunk's identity + hash, used to skip needless re-embedding. */
export interface ExistingChunk {
  chunkSeq: number;
  contentHash: string;
  embedding: Float32Array | null;
  embeddingModel: string | null;
}

/** Minimal candidate shape returned by keyword/semantic candidate queries. */
export interface ChunkCandidate {
  id: string;
  objectType: AiObjectType;
  objectId: string;
  scopeType: AiScopeType;
  scopeId: string;
}

/** Full chunk row hydrated by loadChunks. */
export interface ChunkRow extends ChunkCandidate {
  listId: string | null;
  chunkSeq: number;
  content: string;
  tokenCount: number;
}

export interface CandidateOpts {
  /** Limit to a single scope. */
  scope?: { scopeType: AiScopeType; scopeId: string };
  /** Restrict to one object kind. */
  kind?: AiObjectType;
  /** Max candidates to return (default 50). */
  limit?: number;
}

/** Float32Array → little-endian Buffer for VARBINARY storage. */
function vecToBuffer(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

/** VARBINARY Buffer → Float32Array. Returns null for null/empty. */
function bufferToVec(buf: Buffer | null | undefined): Float32Array | null {
  if (!buf || buf.length === 0) return null;
  // Copy into a fresh, aligned buffer — the mssql Buffer may not be 4-byte
  // aligned, which Float32Array's view constructor requires.
  const aligned = Buffer.allocUnsafe(buf.length);
  buf.copy(aligned);
  return new Float32Array(aligned.buffer, aligned.byteOffset, Math.floor(aligned.length / 4));
}

/** Cosine similarity of two equal-length vectors (assumes both finite). */
function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export class IndexRepository {
  /** Fetch the live (non-deleted) chunks for an object: seq + hash + embedding. */
  async getLiveChunks(workspaceId: string, objectType: AiObjectType, objectId: string): Promise<ExistingChunk[]> {
    const pool = await getPool();
    const res = await pool.request()
      .input('WorkspaceId', sql.UniqueIdentifier, workspaceId)
      .input('ObjectType', sql.NVarChar(20), objectType)
      .input('ObjectId', sql.UniqueIdentifier, objectId)
      .query(`
        SELECT ChunkSeq, ContentHash, Embedding, EmbeddingModel
        FROM dbo.AiChunks
        WHERE WorkspaceId = @WorkspaceId
          AND ObjectType = @ObjectType
          AND ObjectId = @ObjectId
          AND DeletedAt IS NULL
      `);
    return res.recordset.map((r: any) => ({
      chunkSeq: r.ChunkSeq,
      contentHash: r.ContentHash,
      embedding: bufferToVec(r.Embedding),
      embeddingModel: r.EmbeddingModel ?? null,
    }));
  }

  /**
   * Replace an object's chunks: hard-delete its existing LIVE rows, then insert
   * the fresh set in one transaction.
   *
   * ponytail: simplest-correct upsert — delete-then-insert. We DON'T MERGE by
   * hash here because re-embedding is already skipped upstream (the worker reuses
   * existing embeddings for unchanged hashes), so the only cost of replace is the
   * row churn. Upgrade to a MERGE-by-(ObjectId,ChunkSeq,Hash) only if profiling
   * shows the churn is hot.
   */
  async upsertChunks(workspaceId: string, objectType: AiObjectType, objectId: string, rows: ChunkInsert[]): Promise<void> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await new sql.Request(tx)
        .input('WorkspaceId', sql.UniqueIdentifier, workspaceId)
        .input('ObjectType', sql.NVarChar(20), objectType)
        .input('ObjectId', sql.UniqueIdentifier, objectId)
        .query(`
          DELETE FROM dbo.AiChunks
          WHERE WorkspaceId = @WorkspaceId
            AND ObjectType = @ObjectType
            AND ObjectId = @ObjectId
            AND DeletedAt IS NULL
        `);

      for (const row of rows) {
        await new sql.Request(tx)
          .input('WorkspaceId', sql.UniqueIdentifier, row.workspaceId)
          .input('ObjectType', sql.NVarChar(20), row.objectType)
          .input('ObjectId', sql.UniqueIdentifier, row.objectId)
          .input('ScopeType', sql.NVarChar(10), row.scopeType)
          .input('ScopeId', sql.UniqueIdentifier, row.scopeId)
          .input('ListId', sql.UniqueIdentifier, row.listId)
          .input('ChunkSeq', sql.Int, row.chunkSeq)
          .input('Content', sql.NVarChar(sql.MAX), row.content)
          .input('Embedding', sql.VarBinary(sql.MAX), row.embedding ? vecToBuffer(row.embedding) : null)
          .input('EmbeddingModel', sql.NVarChar(60), row.embeddingModel)
          .input('ContentHash', sql.Char(64), row.contentHash)
          .input('TokenCount', sql.Int, row.tokenCount)
          .query(`
            INSERT INTO dbo.AiChunks
              (WorkspaceId, ObjectType, ObjectId, ScopeType, ScopeId, ListId,
               ChunkSeq, Content, Embedding, EmbeddingModel, ContentHash, TokenCount)
            VALUES
              (@WorkspaceId, @ObjectType, @ObjectId, @ScopeType, @ScopeId, @ListId,
               @ChunkSeq, @Content, @Embedding, @EmbeddingModel, @ContentHash, @TokenCount)
          `);
      }
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  }

  /** Soft-delete (tombstone) an object's live chunks. */
  async softDeleteByObject(workspaceId: string, objectType: AiObjectType, objectId: string): Promise<void> {
    const pool = await getPool();
    await pool.request()
      .input('WorkspaceId', sql.UniqueIdentifier, workspaceId)
      .input('ObjectType', sql.NVarChar(20), objectType)
      .input('ObjectId', sql.UniqueIdentifier, objectId)
      .query(`
        UPDATE dbo.AiChunks
        SET DeletedAt = SYSUTCDATETIME()
        WHERE WorkspaceId = @WorkspaceId
          AND ObjectType = @ObjectType
          AND ObjectId = @ObjectId
          AND DeletedAt IS NULL
      `);
  }

  /**
   * Keyword candidates via LIKE term matching, ACL-pre-filtered.
   *
   * ponytail: LIKE keyword fallback — no FTS in container; the test DB reports
   * SERVERPROPERTY('IsFullTextInstalled')=0, so CONTAINS/FREETEXT are unavailable.
   * We split the query into terms and OR `Content LIKE @term_i` (each pattern is a
   * PARAMETER value — user text is never concatenated into SQL). Upgrade to
   * CONTAINS against the FTS index (already declared FTS-guarded in 0063) when
   * full-text is installed.
   */
  async keywordCandidates(
    workspaceId: string, query: string, userId: string, opts: CandidateOpts = {},
  ): Promise<ChunkCandidate[]> {
    const terms = query.toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean).slice(0, 16);
    if (terms.length === 0) return [];
    const limit = opts.limit ?? 50;

    const pool = await getPool();
    const req = pool.request()
      .input('WorkspaceId', sql.UniqueIdentifier, workspaceId)
      .input('UserId', sql.UniqueIdentifier, userId)
      .input('Limit', sql.Int, limit);

    // Build the OR-of-LIKE predicate from parameterized term patterns. Each
    // pattern wraps the (LOWER) term in %…% and ESCAPEs LIKE wildcards so a
    // user term containing % or _ matches literally.
    const likeClauses: string[] = [];
    terms.forEach((term, i) => {
      const escaped = term.replace(/[\\%_[]/g, (m) => `\\${m}`);
      req.input(`term${i}`, sql.NVarChar(450), `%${escaped}%`);
      likeClauses.push(`LOWER(c.Content) LIKE @term${i} ESCAPE '\\'`);
    });

    let scopeClause = '';
    if (opts.scope) {
      req.input('ScopeType', sql.NVarChar(10), opts.scope.scopeType);
      req.input('ScopeId', sql.UniqueIdentifier, opts.scope.scopeId);
      scopeClause = ' AND c.ScopeType = @ScopeType AND c.ScopeId = @ScopeId';
    }
    let kindClause = '';
    if (opts.kind) {
      req.input('Kind', sql.NVarChar(20), opts.kind);
      kindClause = ' AND c.ObjectType = @Kind';
    }

    const res = await req.query(`
      DECLARE @Scopes TABLE (ScopeType NVARCHAR(10), ScopeId UNIQUEIDENTIFIER, PRIMARY KEY (ScopeType, ScopeId));
      INSERT INTO @Scopes (ScopeType, ScopeId)
        EXEC dbo.usp_AccessibleScopes_ForUser @UserId = @UserId, @WorkspaceId = @WorkspaceId;

      SELECT TOP (@Limit) c.Id, c.ObjectType, c.ObjectId, c.ScopeType, c.ScopeId
      FROM dbo.AiChunks c
      JOIN @Scopes s ON s.ScopeType = c.ScopeType AND s.ScopeId = c.ScopeId
      WHERE c.WorkspaceId = @WorkspaceId
        AND c.DeletedAt IS NULL
        AND (${likeClauses.join(' OR ')})
        ${scopeClause}
        ${kindClause}
      ORDER BY c.UpdatedAt DESC;
    `);

    return res.recordset.map((r: any) => ({
      id: r.Id, objectType: r.ObjectType, objectId: r.ObjectId,
      scopeType: r.ScopeType, scopeId: r.ScopeId,
    }));
  }

  /**
   * Semantic candidates: load the ACL-filtered, non-deleted, embedded chunks for
   * the workspace and rank by cosine similarity against `qvec` in JS.
   *
   * ponytail: O(n) brute-force scan over the workspace's embedded chunks — fine at
   * Phase-11a corpus sizes. Upgrade path: an ANN index (DiskANN / pgvector-style
   * vector column) once corpora grow past a few 10k chunks per workspace.
   */
  async semanticCandidates(
    workspaceId: string, qvec: Float32Array, userId: string, opts: CandidateOpts = {},
  ): Promise<ChunkCandidate[]> {
    const limit = opts.limit ?? 50;
    const pool = await getPool();
    const req = pool.request()
      .input('WorkspaceId', sql.UniqueIdentifier, workspaceId)
      .input('UserId', sql.UniqueIdentifier, userId);

    let scopeClause = '';
    if (opts.scope) {
      req.input('ScopeType', sql.NVarChar(10), opts.scope.scopeType);
      req.input('ScopeId', sql.UniqueIdentifier, opts.scope.scopeId);
      scopeClause = ' AND c.ScopeType = @ScopeType AND c.ScopeId = @ScopeId';
    }
    let kindClause = '';
    if (opts.kind) {
      req.input('Kind', sql.NVarChar(20), opts.kind);
      kindClause = ' AND c.ObjectType = @Kind';
    }

    const res = await req.query(`
      DECLARE @Scopes TABLE (ScopeType NVARCHAR(10), ScopeId UNIQUEIDENTIFIER, PRIMARY KEY (ScopeType, ScopeId));
      INSERT INTO @Scopes (ScopeType, ScopeId)
        EXEC dbo.usp_AccessibleScopes_ForUser @UserId = @UserId, @WorkspaceId = @WorkspaceId;

      SELECT c.Id, c.ObjectType, c.ObjectId, c.ScopeType, c.ScopeId, c.Embedding
      FROM dbo.AiChunks c
      JOIN @Scopes s ON s.ScopeType = c.ScopeType AND s.ScopeId = c.ScopeId
      WHERE c.WorkspaceId = @WorkspaceId
        AND c.DeletedAt IS NULL
        AND c.Embedding IS NOT NULL
        ${scopeClause}
        ${kindClause};
    `);

    const scored = res.recordset
      .map((r: any) => {
        const vec = bufferToVec(r.Embedding);
        if (!vec) return null;
        return {
          score: cosine(qvec, vec),
          cand: {
            id: r.Id, objectType: r.ObjectType, objectId: r.ObjectId,
            scopeType: r.ScopeType, scopeId: r.ScopeId,
          } as ChunkCandidate,
        };
      })
      .filter((x): x is { score: number; cand: ChunkCandidate } => x !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map((x) => x.cand);
  }

  /**
   * Hydrate full chunk rows by id, scoped to the workspace.
   *
   * The `ids` passed in are already ACL-filtered: they come from
   * keywordCandidates / semanticCandidates, which both JOIN
   * usp_AccessibleScopes_ForUser before returning. No ACL re-JOIN is needed
   * here — adding one would be a redundant double-check and could mask bugs in
   * the candidate queries. Do NOT pass externally-sourced IDs directly to this
   * method without first running them through keywordCandidates /
   * semanticCandidates (or an equivalent ACL-filtered query).
   */
  async loadChunks(workspaceId: string, ids: string[]): Promise<ChunkRow[]> {
    if (ids.length === 0) return [];
    const pool = await getPool();
    const req = pool.request().input('WorkspaceId', sql.UniqueIdentifier, workspaceId);
    const placeholders = ids.map((id, i) => {
      req.input(`id${i}`, sql.UniqueIdentifier, id);
      return `@id${i}`;
    });
    const res = await req.query(`
      SELECT Id, ObjectType, ObjectId, ScopeType, ScopeId, ListId, ChunkSeq, Content, TokenCount
      FROM dbo.AiChunks
      WHERE WorkspaceId = @WorkspaceId
        AND DeletedAt IS NULL
        AND Id IN (${placeholders.join(', ')})
    `);
    return res.recordset.map((r: any) => ({
      id: r.Id, objectType: r.ObjectType, objectId: r.ObjectId,
      scopeType: r.ScopeType, scopeId: r.ScopeId, listId: r.ListId ?? null,
      chunkSeq: r.ChunkSeq, content: r.Content, tokenCount: r.TokenCount,
    }));
  }
}

export const indexRepository = new IndexRepository();
