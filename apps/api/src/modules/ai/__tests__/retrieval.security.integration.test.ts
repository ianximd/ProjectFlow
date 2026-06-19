/**
 * Phase 11a — Task 9: THE retrieval security gate.
 *
 * Proves RetrievalService.retrieve() NEVER returns content a user cannot VIEW,
 * across BOTH boundaries that prior phases tripped on:
 *   - cross-tenant   (a different workspace's chunks),
 *   - intra-tenant   (a PRIVATE space the user has no grant into).
 *
 * And — the headline assertion — that LAYER 2 (the authoritative accessService.can
 * re-check inside retrieve()) holds EVEN WHEN LAYER 1 (the usp_AccessibleScopes
 * SP pre-filter) is bypassed/buggy and hands back everything. Test 2 simulates the
 * SP returning every chunk id (including the private "nuclear" chunk) and asserts
 * the private chunk STILL does not leak, because can() is authoritative.
 *
 * Reuses the seed patterns from accessible-scopes.integration.test.ts and
 * index.worker.integration.test.ts: createTestUser / Workspace / Project for the
 * graph, usp_Project_SetVisibility for PRIVATE, /lists + /tasks for the corpus,
 * the invite→accept guest flow for the limited user, and runIndexJob to populate
 * dbo.AiChunks synchronously (no Redis).
 *
 * DB SAFETY: local Docker ProjectFlow_Test only.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool, getPool } from '../../../shared/lib/db.js';
import { execSpOne } from '../../../shared/lib/sqlClient.js';
import { runIndexJob } from '../index/ai-index.worker.js';
import { IndexRepository } from '../index/index.repository.js';
import type { ChunkCandidate, CandidateOpts } from '../index/index.repository.js';
import { RetrievalService } from '../retrieval/retrieval.service.js';
import { FakeEmbedder } from '../retrieval/fake.embedder.js';

async function setVisibility(spaceId: string, v: 'PUBLIC' | 'PRIVATE') {
  await execSpOne('usp_Project_SetVisibility', [
    { name: 'Id', type: sql.UniqueIdentifier, value: spaceId },
    { name: 'Visibility', type: sql.NVarChar(10), value: v },
  ]);
}

async function mkList(wsId: string, spaceId: string, token: string, name: string): Promise<string> {
  const d = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token, json: { workspaceId: wsId, spaceId, folderId: null, name, position: 0 },
  }), 201)).data;
  return d.id ?? d.Id;
}

async function mkTask(wsId: string, listId: string, token: string, title: string, description: string): Promise<string> {
  const d = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token,
    json: { workspaceId: wsId, listId, title, description, type: 'TASK' },
  }), 201)).data;
  return d.id ?? d.Id;
}

/** Invite + accept a guest with an explicit grant on one object (from accessible-scopes test). */
async function inviteGuest(
  ownerToken: string, wsId: string, email: string,
  grant: { objectType: 'SPACE' | 'FOLDER' | 'LIST'; objectId: string; level: 'VIEW' | 'COMMENT' | 'EDIT' | 'FULL' },
): Promise<{ id: string }> {
  const guest = await createTestUser({ email });
  const { invite } = await json<{ invite: any }>(await request('/guests/invites', {
    method: 'POST', token: ownerToken,
    json: { workspaceId: wsId, email, objectType: grant.objectType, objectId: grant.objectId, level: grant.level },
  }), 201);
  await json(await request(`/guests/invites/${invite.token}/accept`, {
    method: 'POST', token: guest.accessToken, json: {},
  }), 200);
  return { id: guest.user.Id };
}

/** Every live chunk id in a workspace, read straight from dbo.AiChunks (NO ACL JOIN). */
async function allLiveChunkIds(workspaceId: string): Promise<string[]> {
  const pool = await getPool();
  const res = await pool.request()
    .input('WorkspaceId', sql.UniqueIdentifier, workspaceId)
    .query(`SELECT Id FROM dbo.AiChunks WHERE WorkspaceId = @WorkspaceId AND DeletedAt IS NULL`);
  return res.recordset.map((r: any) => r.Id as string);
}

/** Distinctive marker text per task, used to assert on returned objectIds via content too. */
const TXT = {
  nuclear: 'nuclear launch codes for the secret program',
  lunch: 'team lunch friday at the secret spot downtown',
  tenantB: 'tenant B confidential secret records',
};

interface Scenario {
  wsA: string;
  ownerA: { id: string; token: string };
  secretSpaceId: string;
  nuclearTaskId: string;
  publicListId: string;
  lunchTaskId: string;
  wsB: string;
  tenantBTaskId: string;
  guest: { id: string };
}

/**
 * Seed the full two-workspace scenario and synchronously index every task.
 *
 *  Workspace A (owner A):
 *    - PRIVATE space "Secret"  → list "SecretList" → task TXT.nuclear
 *    - PUBLIC  space "Open"    → list "Public"     → task TXT.lunch
 *    - guest U: invited+accepted on the "Public" LIST only (VIEW).
 *  Workspace B (owner B, separate tenant):
 *    - public list → task TXT.tenantB
 */
async function seedScenario(): Promise<Scenario> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // ---- Workspace A ----
  const ownerA = await createTestUser({ email: `sec-ownerA-${stamp}@projectflow.test` });
  const tA = ownerA.accessToken;
  const wsA = await createTestWorkspace(tA);

  const secretSpace = await createTestProject(wsA.Id, tA, { name: 'Secret', key: `SEC${stamp.replace(/[^a-z0-9]/gi, '').slice(-5).toUpperCase()}` });
  await setVisibility(secretSpace.Id, 'PRIVATE');
  const secretListId = await mkList(wsA.Id, secretSpace.Id, tA, 'SecretList');
  const nuclearTaskId = await mkTask(wsA.Id, secretListId, tA, 'Nuclear plan', TXT.nuclear);

  const openSpace = await createTestProject(wsA.Id, tA, { name: 'Open', key: `OPN${stamp.replace(/[^a-z0-9]/gi, '').slice(-5).toUpperCase()}` });
  const publicListId = await mkList(wsA.Id, openSpace.Id, tA, 'Public');
  const lunchTaskId = await mkTask(wsA.Id, publicListId, tA, 'Lunch plan', TXT.lunch);

  // Limited user U: guest on the Public LIST only (no Secret space, not in ws B).
  const guest = await inviteGuest(tA, wsA.Id, `sec-guest-${stamp}@vendor.io`, {
    objectType: 'LIST', objectId: publicListId, level: 'VIEW',
  });

  // ---- Workspace B (separate owner / tenant) ----
  const ownerB = await createTestUser({ email: `sec-ownerB-${stamp}@projectflow.test` });
  const tB = ownerB.accessToken;
  const wsB = await createTestWorkspace(tB);
  const spaceB = await createTestProject(wsB.Id, tB, { name: 'B', key: `BBB${stamp.replace(/[^a-z0-9]/gi, '').slice(-5).toUpperCase()}` });
  const listB = await mkList(wsB.Id, spaceB.Id, tB, 'ListB');
  const tenantBTaskId = await mkTask(wsB.Id, listB, tB, 'B plan', TXT.tenantB);

  // ---- Index every task synchronously (no Redis). ----
  for (const t of [
    { ws: wsA.Id, id: nuclearTaskId },
    { ws: wsA.Id, id: lunchTaskId },
    { ws: wsB.Id, id: tenantBTaskId },
  ]) {
    const r = await runIndexJob({ workspaceId: t.ws, objectType: 'task', objectId: t.id, op: 'upsert' });
    expect(r.chunks, `task ${t.id} should produce >=1 chunk`).toBeGreaterThan(0);
  }

  return {
    wsA: wsA.Id,
    ownerA: { id: ownerA.user.Id, token: tA },
    secretSpaceId: secretSpace.Id,
    nuclearTaskId,
    publicListId,
    lunchTaskId,
    wsB: wsB.Id,
    tenantBTaskId,
    guest,
  };
}

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

const QUERY = 'secret codes lunch';

describe('RetrievalService.retrieve — cross-tenant + private-space negative (Layer 1 + Layer 2)', () => {
  it('limited guest gets ONLY the public task; private + cross-tenant tasks are excluded; owner sanity-sees the private task', async () => {
    const s = await seedScenario();

    // Real service (real IndexRepository → real SP pre-filter → real can()).
    const svc = new RetrievalService(new IndexRepository(), new FakeEmbedder());

    // --- The limited guest U, scoped to workspace A. ---
    const got = await svc.retrieve(s.guest.id, s.wsA, QUERY, { k: 20 });
    const gotObjectIds = new Set(got.map((c) => c.objectId.toLowerCase()));

    // Positive: U can VIEW the public "lunch" task.
    expect(gotObjectIds.has(s.lunchTaskId.toLowerCase()), 'guest must get the public lunch task').toBe(true);
    // Negative (intra-tenant, PRIVATE space): the nuclear task must NOT appear.
    expect(gotObjectIds.has(s.nuclearTaskId.toLowerCase()), 'guest must NOT get the private nuclear task').toBe(false);
    // Negative (cross-tenant): the workspace-B task must NOT appear (retrieve is ws-A scoped).
    expect(gotObjectIds.has(s.tenantBTaskId.toLowerCase()), 'guest must NOT get the cross-tenant task').toBe(false);
    // Belt-and-braces on content: no leaked marker text.
    for (const c of got) {
      expect(c.content).not.toContain('nuclear');
      expect(c.content).not.toContain('tenant B');
    }

    // --- Sanity: the workspace-A OWNER, same query, DOES see the private nuclear
    //     task. Proves the docs are genuinely indexed/retrievable and it's the
    //     filter (not an empty corpus) that excludes them for U. ---
    const ownerGot = await svc.retrieve(s.ownerA.id, s.wsA, QUERY, { k: 20 });
    const ownerObjectIds = new Set(ownerGot.map((c) => c.objectId.toLowerCase()));
    expect(ownerObjectIds.has(s.nuclearTaskId.toLowerCase()), 'owner must see the private nuclear task').toBe(true);
    expect(ownerObjectIds.has(s.lunchTaskId.toLowerCase()), 'owner must also see the public lunch task').toBe(true);
    // Owner is workspace-A scoped → still no cross-tenant leakage.
    expect(ownerObjectIds.has(s.tenantBTaskId.toLowerCase()), 'owner must NOT see cross-tenant task').toBe(false);
  });
});

describe('RetrievalService.retrieve — SP pre-filter DISABLED, can() still authoritative (Layer 2)', () => {
  it('a leaky candidate repo that returns ALL ws-A chunk ids STILL does not leak the private task to the guest', async () => {
    const s = await seedScenario();

    // Every live chunk id in ws A — INCLUDING the private "nuclear" chunk(s).
    const leakedIds = await allLiveChunkIds(s.wsA);
    expect(leakedIds.length, 'expected several indexed chunks in ws A').toBeGreaterThan(0);

    // Include ws B's ids too, to show they're harmless (loadChunks is ws-scoped so
    // they simply won't hydrate against ws A).
    const wsBIds = await allLiveChunkIds(s.wsB);
    const allIds = [...leakedIds, ...wsBIds];

    /**
     * Leaky repo: simulates usp_AccessibleScopes_ForUser being bypassed/buggy and
     * returning EVERYTHING. keyword/semantic candidates ignore the ACL and hand
     * back every chunk id. loadChunks + the default real accessService.can are
     * left untouched — so Layer 2 is the ONLY thing standing between the caller
     * and the private chunk.
     */
    class LeakyRepo extends IndexRepository {
      private leak(): ChunkCandidate[] {
        // objectType/scopeType/scopeId are not consulted by retrieve() before
        // loadChunks re-hydrates them, so placeholder shape values are fine.
        return allIds.map((id) => ({
          id, objectType: 'task', objectId: id, scopeType: 'LIST', scopeId: id,
        }));
      }
      override async keywordCandidates(_ws: string, _q: string, _u: string, _o?: CandidateOpts): Promise<ChunkCandidate[]> {
        return this.leak();
      }
      override async semanticCandidates(_ws: string, _v: Float32Array, _u: string, _o?: CandidateOpts): Promise<ChunkCandidate[]> {
        return this.leak();
      }
      // loadChunks inherited (REAL, ws-scoped). accessService.can default (REAL).
    }

    const leakySvc = new RetrievalService(new LeakyRepo(), new FakeEmbedder());

    // k high enough to pull every fused candidate through the Layer-2 filter.
    const got = await leakySvc.retrieve(s.guest.id, s.wsA, QUERY, { k: 100 });
    const gotObjectIds = new Set(got.map((c) => c.objectId.toLowerCase()));

    // HEADLINE: even with Layer 1 fully bypassed, can() must still exclude the
    // private nuclear task and any cross-tenant chunk.
    expect(
      gotObjectIds.has(s.nuclearTaskId.toLowerCase()),
      'LAYER 2 LEAK: private nuclear task leaked through can() when the SP was bypassed',
    ).toBe(false);
    expect(
      gotObjectIds.has(s.tenantBTaskId.toLowerCase()),
      'cross-tenant task must not hydrate/leak via ws-A loadChunks',
    ).toBe(false);
    for (const c of got) {
      expect(c.content, 'no private marker text may leak').not.toContain('nuclear');
      expect(c.content, 'no cross-tenant marker text may leak').not.toContain('tenant B');
    }

    // Positive control: the guest's permitted public task DOES still come back —
    // confirms the leaky path actually exercised loadChunks + can() (not vacuous).
    expect(
      gotObjectIds.has(s.lunchTaskId.toLowerCase()),
      'guest must STILL receive the public lunch task through the leaky path',
    ).toBe(true);
  });
});
