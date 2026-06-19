/**
 * Phase 11b — Task 3: THE Q&A security gate (answer + citation layer).
 *
 * Re-runs the 11a cross-tenant + private-space scenario, but asserts on the
 * OUTPUT of QaService.ask() — the answer text and the resolved citations — not
 * just retrieve(). Because citations are parsed only from the (already
 * permission-filtered) retrieved sources, a forbidden object can never be cited
 * and its marker text can never appear in the answer. An owner-positive control
 * proves the corpus is genuinely indexed (non-vacuous).
 *
 * Deterministic via FakeProvider (echoes `[id]` citations) + FakeEmbedder.
 * DB SAFETY: local Docker ProjectFlow_Test only.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';
import { execSpOne } from '../../../shared/lib/sqlClient.js';
import { runIndexJob } from '../index/ai-index.worker.js';
import { IndexRepository } from '../index/index.repository.js';
import { RetrievalService } from '../retrieval/retrieval.service.js';
import { FakeEmbedder } from '../retrieval/fake.embedder.js';
import { FakeProvider } from '../gateway/fake.provider.js';
import { AiGatewayService } from '../gateway/ai-gateway.service.js';
import { QaService } from '../qa/qa.service.js';

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

const TXT = {
  nuclear: 'nuclear launch codes for the secret program',
  lunch: 'team lunch friday at the secret spot downtown',
  tenantB: 'tenant B confidential secret records',
};

interface Scenario {
  wsA: string;
  ownerA: { id: string; token: string };
  nuclearTaskId: string;
  publicListId: string;
  lunchTaskId: string;
  wsB: string;
  tenantBTaskId: string;
  guest: { id: string };
}

async function seedScenario(): Promise<Scenario> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const key5 = (p: string) => `${p}${stamp.replace(/[^a-z0-9]/gi, '').slice(-5).toUpperCase()}`;

  const ownerA = await createTestUser({ email: `qa-ownerA-${stamp}@projectflow.test` });
  const tA = ownerA.accessToken;
  const wsA = await createTestWorkspace(tA);

  const secretSpace = await createTestProject(wsA.Id, tA, { name: 'Secret', key: key5('SEC') });
  await setVisibility(secretSpace.Id, 'PRIVATE');
  const secretListId = await mkList(wsA.Id, secretSpace.Id, tA, 'SecretList');
  const nuclearTaskId = await mkTask(wsA.Id, secretListId, tA, 'Nuclear plan', TXT.nuclear);

  const openSpace = await createTestProject(wsA.Id, tA, { name: 'Open', key: key5('OPN') });
  const publicListId = await mkList(wsA.Id, openSpace.Id, tA, 'Public');
  const lunchTaskId = await mkTask(wsA.Id, publicListId, tA, 'Lunch plan', TXT.lunch);

  const guest = await inviteGuest(tA, wsA.Id, `qa-guest-${stamp}@vendor.io`, {
    objectType: 'LIST', objectId: publicListId, level: 'VIEW',
  });

  const ownerB = await createTestUser({ email: `qa-ownerB-${stamp}@projectflow.test` });
  const tB = ownerB.accessToken;
  const wsB = await createTestWorkspace(tB);
  const spaceB = await createTestProject(wsB.Id, tB, { name: 'B', key: key5('BBB') });
  const listB = await mkList(wsB.Id, spaceB.Id, tB, 'ListB');
  const tenantBTaskId = await mkTask(wsB.Id, listB, tB, 'B plan', TXT.tenantB);

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
    nuclearTaskId,
    publicListId,
    lunchTaskId,
    wsB: wsB.Id,
    tenantBTaskId,
    guest,
  };
}

// Deterministic QaService: real retrieval (real SP + real can()) + FakeEmbedder
// (matches the indexing embedder) + FakeProvider (echoes [id] citations).
function makeQa(): QaService {
  const retrieval = new RetrievalService(new IndexRepository(), new FakeEmbedder());
  const gateway = new AiGatewayService(new FakeProvider());
  return new QaService(retrieval, gateway);
}

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

const QUESTION = 'what is at risk? secret codes lunch';

describe('QaService.ask — cross-tenant + private-space answer/citation security', () => {
  it('never cites or surfaces content the user cannot VIEW; owner control proves the corpus is indexed', async () => {
    const s = await seedScenario();
    const qa = makeQa();

    // --- Limited guest U, scoped to workspace A. ---
    const { answer, citations } = await qa.ask(s.guest.id, s.wsA, QUESTION);
    const citedIds = new Set(citations.map((c) => c.objectId.toLowerCase()));

    // Positive: the public lunch task is cited.
    expect(citedIds.has(s.lunchTaskId.toLowerCase()), 'guest must cite the public lunch task').toBe(true);
    // Negative (intra-tenant private space): nuclear task is never cited.
    expect(citedIds.has(s.nuclearTaskId.toLowerCase()), 'guest must NOT cite the private nuclear task').toBe(false);
    // Negative (cross-tenant): workspace-B task is never cited.
    expect(citedIds.has(s.tenantBTaskId.toLowerCase()), 'guest must NOT cite the cross-tenant task').toBe(false);
    // The answer text must not surface forbidden marker content.
    expect(answer).not.toContain('nuclear');
    expect(answer).not.toContain('tenant B');

    // --- Owner control: same question, the owner DOES cite the private nuclear
    //     task — proving the corpus is genuinely indexed and it's the permission
    //     filter (not an empty corpus) that excludes it for the guest. ---
    const ownerRes = await qa.ask(s.ownerA.id, s.wsA, QUESTION);
    const ownerCited = new Set(ownerRes.citations.map((c) => c.objectId.toLowerCase()));
    expect(ownerCited.has(s.nuclearTaskId.toLowerCase()), 'owner must cite the private nuclear task').toBe(true);
    expect(ownerCited.has(s.lunchTaskId.toLowerCase()), 'owner must also cite the public lunch task').toBe(true);
    // Owner is workspace-A scoped → still no cross-tenant citation.
    expect(ownerCited.has(s.tenantBTaskId.toLowerCase()), 'owner must NOT cite the cross-tenant task').toBe(false);
  });
});
