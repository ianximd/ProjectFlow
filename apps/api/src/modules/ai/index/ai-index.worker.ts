/**
 * AI indexing worker (Phase 11a).
 *
 * Consumes the `ai-index` queue and keeps dbo.AiChunks in sync with the source
 * objects (tasks / docs / comments). The actual work lives in `runIndexJob`, a
 * directly-callable function so unit/integration tests can drive it without
 * Redis or a Worker. `startAiIndexWorker()` is only the BullMQ consumer + timer
 * wiring (mirrors recurrence.worker).
 *
 * Per object on `op:'upsert'`:
 *   1. Resolve the object's text + ACL anchor (ScopeType/ScopeId/ListId).
 *   2. chunkText → per-chunk sha256 ContentHash.
 *   3. Re-embed only chunks whose hash differs from the existing live row
 *      (reuse the stored embedding otherwise) — avoids needless embedder calls.
 *   4. indexRepository.upsertChunks (delete-then-insert the fresh set).
 *
 * Object → scope mapping (derived from the schema/services):
 *   - task:    ScopeType='LIST', ScopeId=Tasks.ListId, ListId=Tasks.ListId.
 *              Text = Title + Description.
 *   - comment: resolve to its task, then the task's ListId. ScopeType='LIST',
 *              ScopeId=ListId, ListId=ListId. Text = comment Body.
 *   - doc:     ScopeType/ScopeId come straight off the Doc row (SPACE/FOLDER/
 *              LIST); ListId = ScopeId only when ScopeType='LIST', else null.
 *              Text = Doc.Name + plain text extracted from every page's BodyJson.
 */

import { Worker } from 'bullmq';
import { createHash } from 'node:crypto';
import { subLogger } from '../../../shared/lib/logger.js';
import { registerCloser } from '../../../shared/lib/shutdown.js';
import { getPool } from '../../../shared/lib/db.js';
import sql from 'mssql';
import { chunkText } from '../retrieval/chunk.js';
import { makeEmbedder } from '../retrieval/voyage.embedder.js';
import {
  indexRepository, type ChunkInsert, type AiScopeType,
} from './index.repository.js';
import { AI_INDEX_QUEUE, aiIndexConnection, type AiIndexJobData } from './ai-index.queue.js';

const log = subLogger('ai-index');

/** sha256 hex of a chunk's content — the re-embed skip key. */
function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

interface ResolvedObject {
  scopeType: AiScopeType;
  scopeId: string;
  listId: string | null;
  text: string;
}

/**
 * Recursively pull plain text out of a TipTap/ProseMirror JSON node.
 *
 * ponytail: minimal recursive extractor — no existing shared doc→plaintext
 * helper exists (BodyJson is only ever persisted/loaded as opaque Yjs/JSON), so
 * we walk `text` leaves + recurse `content`. Good enough for retrieval; swap for
 * a shared extractor if one is introduced.
 */
function extractTiptapText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(extractTiptapText).join(' ');
  if (typeof node === 'object') {
    const n = node as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof n.text === 'string') parts.push(n.text);
    if (n.content) parts.push(extractTiptapText(n.content));
    return parts.join(' ');
  }
  return '';
}

/** Parse a BodyJson string and return its plain text (empty on any failure). */
function bodyJsonToText(bodyJson: string | null | undefined): string {
  if (!bodyJson) return '';
  try {
    return extractTiptapText(JSON.parse(bodyJson)).replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

/** Resolve a task's scope anchor + indexable text. Null if not found / no list. */
async function resolveTask(workspaceId: string, taskId: string): Promise<ResolvedObject | null> {
  const pool = await getPool();
  const res = await pool.request()
    .input('TaskId', sql.UniqueIdentifier, taskId)
    .query(`SELECT Title, Description, ListId, WorkspaceId FROM dbo.Tasks WHERE Id = @TaskId AND DeletedAt IS NULL`);
  const row = res.recordset[0];
  if (!row || !row.ListId) return null; // ScopeType='LIST' requires a list anchor
  const text = [row.Title ?? '', row.Description ?? ''].filter(Boolean).join('\n\n').trim();
  return { scopeType: 'LIST', scopeId: row.ListId, listId: row.ListId, text };
}

/** Resolve a comment → its task's list anchor + the comment body as text. */
async function resolveComment(workspaceId: string, commentId: string): Promise<ResolvedObject | null> {
  const pool = await getPool();
  const res = await pool.request()
    .input('CommentId', sql.UniqueIdentifier, commentId)
    .query(`
      SELECT c.Body, t.ListId
      FROM dbo.Comments c
      JOIN dbo.Tasks t ON t.Id = c.TaskId
      WHERE c.Id = @CommentId AND c.DeletedAt IS NULL AND t.DeletedAt IS NULL
    `);
  const row = res.recordset[0];
  if (!row || !row.ListId) return null;
  const text = (row.Body ?? '').trim();
  return { scopeType: 'LIST', scopeId: row.ListId, listId: row.ListId, text };
}

/** Resolve a doc → its scope node + (name + all page bodies) as text. */
async function resolveDoc(workspaceId: string, docId: string): Promise<ResolvedObject | null> {
  const pool = await getPool();
  const docRes = await pool.request()
    .input('DocId', sql.UniqueIdentifier, docId)
    .query(`SELECT Name, ScopeType, ScopeId FROM dbo.Docs WHERE Id = @DocId`);
  const doc = docRes.recordset[0];
  if (!doc) return null;

  const pagesRes = await pool.request()
    .input('DocId', sql.UniqueIdentifier, docId)
    .query(`
      SELECT Title, BodyJson
      FROM dbo.DocPages
      WHERE DocId = @DocId AND DeletedAt IS NULL
      ORDER BY Position
    `);

  const parts: string[] = [doc.Name ?? ''];
  for (const p of pagesRes.recordset) {
    if (p.Title) parts.push(p.Title);
    const body = bodyJsonToText(p.BodyJson);
    if (body) parts.push(body);
  }
  const text = parts.filter(Boolean).join('\n\n').trim();

  const scopeType = doc.ScopeType as AiScopeType;
  // ListId is only meaningful when the doc is list-bound; null otherwise.
  const listId = scopeType === 'LIST' ? doc.ScopeId : null;
  return { scopeType, scopeId: doc.ScopeId, listId, text };
}

async function resolveObject(data: AiIndexJobData): Promise<ResolvedObject | null> {
  switch (data.objectType) {
    case 'task':    return resolveTask(data.workspaceId, data.objectId);
    case 'comment': return resolveComment(data.workspaceId, data.objectId);
    case 'doc':     return resolveDoc(data.workspaceId, data.objectId);
    default:        return null;
  }
}

/**
 * Core indexing logic — directly callable (tests drive this without Redis).
 */
export async function runIndexJob(data: AiIndexJobData): Promise<{ chunks: number }> {
  if (data.op === 'delete') {
    await indexRepository.softDeleteByObject(data.workspaceId, data.objectType, data.objectId);
    return { chunks: 0 };
  }

  const resolved = await resolveObject(data);
  if (!resolved) {
    // Object gone / no scope anchor — treat as a delete so stale chunks don't linger.
    await indexRepository.softDeleteByObject(data.workspaceId, data.objectType, data.objectId);
    return { chunks: 0 };
  }

  const chunks = chunkText(resolved.text);
  if (chunks.length === 0) {
    // No indexable text → tombstone any existing chunks.
    await indexRepository.softDeleteByObject(data.workspaceId, data.objectType, data.objectId);
    return { chunks: 0 };
  }

  // Map existing live chunks by content hash so we can reuse embeddings whose
  // content didn't change (skip re-embedding).
  const existing = await indexRepository.getLiveChunks(data.workspaceId, data.objectType, data.objectId);
  const reusableByHash = new Map<string, { embedding: Float32Array | null; embeddingModel: string | null }>();
  for (const e of existing) {
    if (e.embedding) reusableByHash.set(e.contentHash, { embedding: e.embedding, embeddingModel: e.embeddingModel });
  }

  const hashes = chunks.map((c) => hashContent(c.content));

  // Embed only the chunks whose hash isn't already covered by a live row.
  const embedder = makeEmbedder();
  const toEmbedIdx: number[] = [];
  hashes.forEach((h, i) => { if (!reusableByHash.has(h)) toEmbedIdx.push(i); });
  let freshEmbeddings: Float32Array[] = [];
  if (toEmbedIdx.length > 0) {
    freshEmbeddings = await embedder.embed(toEmbedIdx.map((i) => chunks[i].content));
  }
  const freshByIdx = new Map<number, Float32Array>();
  toEmbedIdx.forEach((origIdx, k) => freshByIdx.set(origIdx, freshEmbeddings[k]));

  const rows: ChunkInsert[] = chunks.map((c, i) => {
    const hash = hashes[i];
    const reused = reusableByHash.get(hash);
    const embedding = reused?.embedding ?? freshByIdx.get(i) ?? null;
    const embeddingModel = reused?.embedding ? reused.embeddingModel : embedder.model;
    return {
      workspaceId: data.workspaceId,
      objectType: data.objectType,
      objectId: data.objectId,
      scopeType: resolved.scopeType,
      scopeId: resolved.scopeId,
      listId: resolved.listId,
      chunkSeq: c.seq,
      content: c.content,
      embedding,
      embeddingModel: embedding ? embeddingModel : null,
      contentHash: hash,
      tokenCount: c.tokenCount,
    };
  });

  await indexRepository.upsertChunks(data.workspaceId, data.objectType, data.objectId, rows);
  return { chunks: rows.length };
}

let started = false;

/** Start the BullMQ Worker consuming the ai-index queue. */
export async function startAiIndexWorker(): Promise<Worker<AiIndexJobData> | null> {
  if (started) throw new Error('startAiIndexWorker called twice');
  started = true;

  const worker = new Worker<AiIndexJobData>(
    AI_INDEX_QUEUE,
    async (job) => {
      const result = await runIndexJob(job.data);
      return result;
    },
    { connection: aiIndexConnection, concurrency: 4 },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, data: job?.data, err: err?.message }, 'ai-index job failed');
  });
  worker.on('error', (err) => {
    log.error({ err: err?.message }, 'ai-index worker error');
  });

  registerCloser('ai-index-worker', () => worker.close());
  log.info('ai-index worker started');
  return worker;
}
