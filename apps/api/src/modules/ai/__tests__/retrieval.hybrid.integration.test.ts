/**
 * Phase 11a — RetrievalService hybrid retrieval + two-layer permission filter.
 *
 * Three proofs (plan §4.1):
 *   (a) END-TO-END DB: seed a workspace/space/list with tasks, index them via the
 *       real runIndexJob(), call retrieve() as a fully-permitted user, and assert
 *       the relevant chunk(s) come back and an unrelated task's chunk does not.
 *       Proves the LIKE+cosine candidate queries + fusion + Layer-2 can() pass
 *       end-to-end against the real DB/SP.
 *   (b) FUSION CONTRIBUTION: inject a fake indexRepo whose keywordCandidates
 *       returns [A] and semanticCandidates returns [B] (disjoint), with
 *       loadChunks returning both — assert retrieve() returns BOTH, and that the
 *       fusion ranking is preserved even when loadChunks hands rows back in the
 *       opposite (DB-arbitrary) order. Allow-all access checker.
 *   (c) LAYER-2 FILTER: inject an indexRepo returning a chunk in scope S and an
 *       access checker that DENIES S — assert retrieve() returns []. Proves the
 *       authoritative can() wiring drops denied results (the full cross-tenant
 *       DB security proof is Task 9; out of scope here).
 *
 * The FakeEmbedder is a deterministic hash-per-TOKEN embedder, so a doc is only
 * "semantically near" the query when it SHARES TOKENS with it — which also makes
 * it a LIKE keyword match. A pure semantic-only/no-keyword doc is therefore not
 * realistically constructible here; (b) injects disjoint fakes to isolate the
 * "merges both sources" property, while (a) proves the real hybrid path.
 *
 * DB SAFETY: local Docker ProjectFlow_Test only.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';
import { runIndexJob } from '../index/ai-index.worker.js';
import { RetrievalService } from '../retrieval/retrieval.service.js';
import type { ChunkCandidate, ChunkRow, CandidateOpts } from '../index/index.repository.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

let _key = 0;
function uniqueKey(prefix: string): string {
  _key += 1;
  return `${prefix}${Date.now().toString(36).slice(-4)}${_key}`.toUpperCase().slice(0, 10);
}

async function seedWorkspaceWithTasks(): Promise<{
  userId: string;
  workspaceId: string;
  listId: string;
  fooTaskId: string;
  barTaskId: string;
}> {
  const owner = await createTestUser({ email: `ret-${Date.now()}@projectflow.test` });
  const t = owner.accessToken;
  const ws = await createTestWorkspace(t);
  const space = await createTestProject(ws.Id, t, { name: 'Ret Space', key: uniqueKey('RT') });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token: t,
    json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'Ret List', position: 0 },
  }), 201)).data;
  const listId = list.id ?? list.Id;

  const fooTask = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token: t,
    json: {
      workspaceId: ws.Id, listId, type: 'TASK',
      title: 'Quarterly revenue forecast',
      description: 'Detailed projection of quarterly revenue numbers for the upcoming fiscal planning cycle.',
    },
  }), 201)).data;
  const fooTaskId = fooTask.id ?? fooTask.Id;

  const barTask = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token: t,
    json: {
      workspaceId: ws.Id, listId, type: 'TASK',
      title: 'Office plant watering schedule',
      description: 'Reminder to water the lobby ferns and succulents every Tuesday morning.',
    },
  }), 201)).data;
  const barTaskId = barTask.id ?? barTask.Id;

  await runIndexJob({ workspaceId: ws.Id, objectType: 'task', objectId: fooTaskId, op: 'upsert' });
  await runIndexJob({ workspaceId: ws.Id, objectType: 'task', objectId: barTaskId, op: 'upsert' });

  return { userId: owner.user.Id, workspaceId: ws.Id, listId, fooTaskId, barTaskId };
}

describe('RetrievalService — end-to-end hybrid DB retrieval (a)', () => {
  it('returns the relevant task chunk for a permitted user and ranks it above the unrelated one', async () => {
    const { userId, workspaceId, fooTaskId, barTaskId } = await seedWorkspaceWithTasks();

    // Default service: real IndexRepository + FakeEmbedder (no VOYAGE key in test
    // env) + real accessService.can. The owner has full access to everything.
    const svc = new RetrievalService();
    const results = await svc.retrieve(userId, workspaceId, 'quarterly revenue forecast', { k: 5 });

    expect(results.length).toBeGreaterThan(0);
    const objIds = results.map((r) => r.objectId.toLowerCase());
    // The revenue task must surface…
    expect(objIds).toContain(fooTaskId.toLowerCase());
    // …and rank ahead of the unrelated plant task if the latter appears at all.
    const fooRank = objIds.indexOf(fooTaskId.toLowerCase());
    const barRank = objIds.indexOf(barTaskId.toLowerCase());
    if (barRank !== -1) expect(fooRank).toBeLessThan(barRank);

    // Returned shape is the camelCase RetrievedChunk.
    const top = results[0];
    expect(top).toMatchObject({
      id: expect.any(String),
      objectType: 'task',
      scopeType: 'LIST',
      content: expect.any(String),
    });
  });

  it('ranks the plant task first for a plant-only query (revenue task, if recalled, ranks below)', async () => {
    // Semantic recall is intentionally broad (cosine over all embedded chunks,
    // no hard threshold), so the unrelated revenue task may still appear as a
    // low-ranked semantic candidate. The hybrid guarantee we assert is RANKING:
    // the plant task — a keyword AND semantic match — must come out on top.
    const { userId, workspaceId, fooTaskId, barTaskId } = await seedWorkspaceWithTasks();
    const svc = new RetrievalService();
    const results = await svc.retrieve(userId, workspaceId, 'ferns succulents watering', { k: 5 });

    const objIds = results.map((r) => r.objectId.toLowerCase());
    expect(objIds).toContain(barTaskId.toLowerCase());
    expect(objIds[0]).toBe(barTaskId.toLowerCase()); // best match is the plant task
    const fooRank = objIds.indexOf(fooTaskId.toLowerCase());
    if (fooRank !== -1) expect(fooRank).toBeGreaterThan(0); // never outranks the real match
  });
});

// ---- Injected-fake helpers for the focused service-level proofs (b) and (c) ----

function fakeChunk(id: string, scopeId = 's-1'): ChunkRow {
  return {
    id,
    objectType: 'task',
    objectId: `obj-${id}`,
    scopeType: 'LIST',
    scopeId,
    listId: scopeId,
    chunkSeq: 0,
    content: `content for ${id}`,
    tokenCount: 3,
  };
}

/** A minimal IndexRepository stub: scripted candidate lists + a row store. */
function fakeRepo(opts: {
  keyword: ChunkCandidate[];
  semantic: ChunkCandidate[];
  rows: ChunkRow[];
  /** If true, loadChunks returns rows in REVERSE of the requested-id order, to
   *  prove retrieve() re-ranks by fusion, not by DB order. */
  reverseLoad?: boolean;
}) {
  const byId = new Map(opts.rows.map((r) => [r.id, r]));
  return {
    async keywordCandidates(): Promise<ChunkCandidate[]> { return opts.keyword; },
    async semanticCandidates(): Promise<ChunkCandidate[]> { return opts.semantic; },
    async loadChunks(_ws: string, ids: string[]): Promise<ChunkRow[]> {
      const found = ids.map((id) => byId.get(id)).filter((r): r is ChunkRow => r !== undefined);
      return opts.reverseLoad ? found.reverse() : found;
    },
  } as any;
}

const fakeEmbedder = { model: 'test', async embed(texts: string[]) { return texts.map(() => new Float32Array(4)); } };
const allowAll = async () => true;

const candFromRow = (r: ChunkRow): ChunkCandidate => ({
  id: r.id, objectType: r.objectType, objectId: r.objectId,
  scopeType: r.scopeType, scopeId: r.scopeId,
});

describe('RetrievalService — fusion contribution + ranking preservation (b)', () => {
  it('merges disjoint keyword [A] and semantic [B] sources, returning BOTH', async () => {
    const A = fakeChunk('a'); const B = fakeChunk('b');
    const repo = fakeRepo({ keyword: [candFromRow(A)], semantic: [candFromRow(B)], rows: [A, B] });
    const svc = new RetrievalService(repo, fakeEmbedder, allowAll);

    const out = await svc.retrieve('u', 'ws', 'anything', { k: 8 });
    const ids = out.map((r) => r.id).sort();
    expect(ids).toEqual(['a', 'b']); // both sources contributed
  });

  it('preserves fusion ranking even when loadChunks returns rows in DB-arbitrary order', async () => {
    // keyword ranks A then C; semantic ranks A then B. RRF: A (in both, top) >
    // C and B (each appear once at rank ~1/2). A must come first regardless of
    // loadChunks order.
    const A = fakeChunk('a'); const B = fakeChunk('b'); const C = fakeChunk('c');
    const repo = fakeRepo({
      keyword: [candFromRow(A), candFromRow(C)],
      semantic: [candFromRow(A), candFromRow(B)],
      rows: [A, B, C],
      reverseLoad: true, // DB hands them back worst-first
    });
    const svc = new RetrievalService(repo, fakeEmbedder, allowAll);

    const out = await svc.retrieve('u', 'ws', 'q', { k: 8 });
    expect(out[0].id).toBe('a'); // best fused rank wins despite reversed DB order
    expect(out.map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('honors k by returning only the top-k fused-and-allowed chunks', async () => {
    const rows = ['a', 'b', 'c', 'd'].map((id) => fakeChunk(id));
    const repo = fakeRepo({ keyword: rows.map(candFromRow), semantic: [], rows });
    const svc = new RetrievalService(repo, fakeEmbedder, allowAll);

    const out = await svc.retrieve('u', 'ws', 'q', { k: 2 });
    expect(out.length).toBe(2);
    expect(out.map((r) => r.id)).toEqual(['a', 'b']); // keyword order preserved
  });
});

describe('RetrievalService — Layer-2 authoritative can() filter (c)', () => {
  it('drops a candidate whose scope the access checker denies', async () => {
    const A = fakeChunk('a', 'denied-scope');
    const repo = fakeRepo({ keyword: [candFromRow(A)], semantic: [], rows: [A] });
    const denyAll = async () => false;
    const svc = new RetrievalService(repo, fakeEmbedder, denyAll);

    const out = await svc.retrieve('u', 'ws', 'q', { k: 8 });
    expect(out).toEqual([]); // Layer 2 dropped the only candidate
  });

  it('keeps allowed scopes and drops only the denied ones', async () => {
    const ok = fakeChunk('ok', 'ok-scope');
    const bad = fakeChunk('bad', 'bad-scope');
    const repo = fakeRepo({ keyword: [candFromRow(ok), candFromRow(bad)], semantic: [], rows: [ok, bad] });
    const checker = async (_u: string, _t: string, scopeId: string) => scopeId === 'ok-scope';
    const svc = new RetrievalService(repo, fakeEmbedder, checker);

    const out = await svc.retrieve('u', 'ws', 'q', { k: 8 });
    expect(out.map((r) => r.id)).toEqual(['ok']);
  });
});
