/**
 * Phase 11a — AI indexing worker integration coverage.
 *
 * Drives runIndexJob() DIRECTLY (no Redis, no BullMQ) to verify the upsert /
 * re-index / soft-delete lifecycle against dbo.AiChunks for a task, including
 * the LIST scope anchor mapping and content-hash change on edit.
 *
 * DB SAFETY: must target local Docker ProjectFlow_Test.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool, getPool } from '../../../shared/lib/db.js';
import { runIndexJob } from '../index/ai-index.worker.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

interface ChunkRow {
  Id: string;
  WorkspaceId: string;
  ObjectType: string;
  ObjectId: string;
  ScopeType: string;
  ScopeId: string;
  ListId: string | null;
  ChunkSeq: number;
  Content: string;
  Embedding: Buffer | null;
  ContentHash: string;
  DeletedAt: Date | null;
}

async function liveChunks(workspaceId: string, objectId: string): Promise<ChunkRow[]> {
  const pool = await getPool();
  const res = await pool.request()
    .input('WorkspaceId', sql.UniqueIdentifier, workspaceId)
    .input('ObjectId', sql.UniqueIdentifier, objectId)
    .query(`
      SELECT Id, WorkspaceId, ObjectType, ObjectId, ScopeType, ScopeId, ListId,
             ChunkSeq, Content, Embedding, ContentHash, DeletedAt
      FROM dbo.AiChunks
      WHERE WorkspaceId = @WorkspaceId AND ObjectId = @ObjectId AND DeletedAt IS NULL
      ORDER BY ChunkSeq
    `);
  return res.recordset as ChunkRow[];
}

async function allChunks(workspaceId: string, objectId: string): Promise<ChunkRow[]> {
  const pool = await getPool();
  const res = await pool.request()
    .input('WorkspaceId', sql.UniqueIdentifier, workspaceId)
    .input('ObjectId', sql.UniqueIdentifier, objectId)
    .query(`
      SELECT Id, ChunkSeq, Content, ContentHash, DeletedAt
      FROM dbo.AiChunks
      WHERE WorkspaceId = @WorkspaceId AND ObjectId = @ObjectId
    `);
  return res.recordset as ChunkRow[];
}

async function seedTaskInList(opts: { title: string; description: string }): Promise<{
  workspaceId: string; listId: string; taskId: string;
}> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const owner = await createTestUser({ email: `aiidx-${stamp}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, {
    name: 'Idx Space',
    key: `IX${stamp.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()}`,
  });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token,
    json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'Idx List', position: 0 },
  }), 201)).data;
  const listId = list.id ?? list.Id;

  const task = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token,
    json: { workspaceId: ws.Id, listId, title: opts.title, description: opts.description, type: 'TASK' },
  }), 201)).data;
  const taskId = task.id ?? task.Id;

  return { workspaceId: ws.Id, listId, taskId };
}

describe('ai-index worker — task lifecycle', () => {
  it('upsert: indexes a task with LIST scope anchor, content, hash, and embedding', async () => {
    const { workspaceId, listId, taskId } = await seedTaskInList({
      title: 'Indexable task title',
      description: 'A description with enough words to make a meaningful searchable chunk for retrieval.',
    });

    const result = await runIndexJob({ workspaceId, objectType: 'task', objectId: taskId, op: 'upsert' });
    expect(result.chunks).toBeGreaterThan(0);

    const rows = await liveChunks(workspaceId, taskId);
    expect(rows.length).toBe(result.chunks);
    for (const r of rows) {
      expect(r.WorkspaceId.toLowerCase()).toBe(workspaceId.toLowerCase());
      expect(r.ObjectType).toBe('task');
      expect(r.ObjectId.toLowerCase()).toBe(taskId.toLowerCase());
      expect(r.ScopeType).toBe('LIST');
      expect(r.ScopeId.toLowerCase()).toBe(listId.toLowerCase());
      expect(r.ListId?.toLowerCase()).toBe(listId.toLowerCase());
      expect(r.Content.length).toBeGreaterThan(0);
      expect(r.ContentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.Embedding).not.toBeNull();
      expect((r.Embedding as Buffer).length).toBeGreaterThan(0);
    }
  });

  it('re-upsert after edit: content + hash change, old live chunks replaced', async () => {
    const { workspaceId, taskId } = await seedTaskInList({
      title: 'Original title',
      description: 'Original body text for the first version of this task.',
    });

    await runIndexJob({ workspaceId, objectType: 'task', objectId: taskId, op: 'upsert' });
    const before = await liveChunks(workspaceId, taskId);
    const beforeHash = before[0].ContentHash;
    const beforeContent = before[0].Content;

    // Update the task text directly so the worker re-reads fresh content on the
    // next upsert (the worker reads dbo.Tasks; no re-auth bookkeeping needed).
    const pool = await getPool();
    await pool.request()
      .input('TaskId', sql.UniqueIdentifier, taskId)
      .query(`UPDATE dbo.Tasks
              SET Title = N'Completely different heading',
                  Description = N'Brand new body content that shares no words with the prior revision whatsoever.'
              WHERE Id = @TaskId`);

    await runIndexJob({ workspaceId, objectType: 'task', objectId: taskId, op: 'upsert' });
    const after = await liveChunks(workspaceId, taskId);

    expect(after[0].Content).not.toBe(beforeContent);
    expect(after[0].ContentHash).not.toBe(beforeHash);
    expect(after[0].Content).toContain('Completely different heading');

    // Old live chunk ids must not survive as live rows (delete-then-insert).
    const beforeIds = new Set(before.map((r) => r.Id));
    for (const r of after) expect(beforeIds.has(r.Id)).toBe(false);
  });

  it('delete: soft-deletes the task chunks (DeletedAt set)', async () => {
    const { workspaceId, taskId } = await seedTaskInList({
      title: 'Doomed task',
      description: 'This task and its chunks will be tombstoned by the delete op.',
    });

    await runIndexJob({ workspaceId, objectType: 'task', objectId: taskId, op: 'upsert' });
    expect((await liveChunks(workspaceId, taskId)).length).toBeGreaterThan(0);

    await runIndexJob({ workspaceId, objectType: 'task', objectId: taskId, op: 'delete' });

    expect((await liveChunks(workspaceId, taskId)).length).toBe(0);
    const all = await allChunks(workspaceId, taskId);
    expect(all.length).toBeGreaterThan(0);
    for (const r of all) expect(r.DeletedAt).not.toBeNull();
  });
});
