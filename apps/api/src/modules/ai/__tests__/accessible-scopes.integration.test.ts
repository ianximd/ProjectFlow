/**
 * Phase 11a — usp_AccessibleScopes_ForUser: the SET-based ACL pre-filter for AI
 * retrieval. It returns the (ScopeType, ScopeId) nodes a user can VIEW in a
 * workspace and MUST agree, node-for-node, with the authoritative per-object
 * resolver usp_ObjectAccess_Resolve.
 *
 * Two layers of proof:
 *   1. Explicit guest / member scenarios from the plan.
 *   2. ORACLE cross-check: for every scope node, call usp_ObjectAccess_Resolve
 *      and assert the set SP returns EXACTLY { nodes where resolver Level IS NOT
 *      NULL }, for a guest, a regular member, and a non-member/cross-ws user.
 *
 * DB SAFETY: local Docker ProjectFlow_Test only.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool, getPool } from '../../../shared/lib/db.js';
import { execSp, execSpOne } from '../../../shared/lib/sqlClient.js';

type ScopeRow = { ScopeType: string; ScopeId: string };
type ResolveRow = { Level: string | null; Found: boolean };

const KEY = (r: { ScopeType?: string; type: string; ScopeId?: string; id?: string }) =>
  `${(r.ScopeType ?? r.type).toUpperCase()}:${(r.ScopeId ?? r.id)!.toLowerCase()}`;

async function accessibleScopes(userId: string, workspaceId: string): Promise<Set<string>> {
  const rows = await execSpOne<ScopeRow>('usp_AccessibleScopes_ForUser', [
    { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
    { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
  ]);
  return new Set(rows.map((r) => KEY({ ScopeType: r.ScopeType, type: r.ScopeType, ScopeId: r.ScopeId })));
}

async function resolveOne(userId: string, objectType: string, objectId: string): Promise<ResolveRow> {
  const sets = await execSp<ResolveRow>('usp_ObjectAccess_Resolve', [
    { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
    { name: 'ObjectType', type: sql.NVarChar(8), value: objectType },
    { name: 'ObjectId', type: sql.UniqueIdentifier, value: objectId },
  ]);
  return sets[0]![0]!;
}

async function setVisibility(spaceId: string, v: 'PUBLIC' | 'PRIVATE') {
  await execSpOne('usp_Project_SetVisibility', [
    { name: 'Id', type: sql.UniqueIdentifier, value: spaceId },
    { name: 'Visibility', type: sql.NVarChar(10), value: v },
  ]);
}

async function mkFolder(wsId: string, spaceId: string, token: string, name: string): Promise<{ type: 'FOLDER'; id: string }> {
  const d = (await json<{ data: any }>(await request('/folders', {
    method: 'POST', token, json: { workspaceId: wsId, spaceId, name, position: 0 },
  }), 201)).data;
  return { type: 'FOLDER', id: d.id ?? d.Id };
}

async function mkList(wsId: string, spaceId: string, folderId: string | null, token: string, name: string): Promise<{ type: 'LIST'; id: string }> {
  const d = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token, json: { workspaceId: wsId, spaceId, folderId, name, position: 0 },
  }), 201)).data;
  return { type: 'LIST', id: d.id ?? d.Id };
}

/** Invite + accept a guest with an explicit grant on one object. */
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

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

describe('usp_AccessibleScopes_ForUser — explicit scenarios', () => {
  it('guest granted VIEW on List L1 (PRIVATE space A, sibling L2): returns ONLY L1', async () => {
    const owner = await createTestUser({ email: `as-owner-${Date.now()}@projectflow.test` });
    const t = owner.accessToken;
    const ws = await createTestWorkspace(t);
    const spaceA = await createTestProject(ws.Id, t, { name: 'A', key: `AA${Date.now() % 100000}` });
    await setVisibility(spaceA.Id, 'PRIVATE');
    const l1 = await mkList(ws.Id, spaceA.Id, null, t, 'L1');
    const l2 = await mkList(ws.Id, spaceA.Id, null, t, 'L2');

    const guest = await inviteGuest(t, ws.Id, `as-guest-${Date.now()}@vendor.io`, {
      objectType: 'LIST', objectId: l1.id, level: 'VIEW',
    });

    const scopes = await accessibleScopes(guest.id, ws.Id);
    expect(scopes.has(KEY(l1))).toBe(true);    // the granted list
    expect(scopes.has(KEY(l2))).toBe(false);   // sibling — no grant
    expect(scopes.has(KEY({ type: 'SPACE', id: spaceA.Id }))).toBe(false); // space invisible
    expect(scopes.size).toBe(1);
  });

  it('regular member sees the floor-visible scopes (space + folder + list of a PUBLIC space)', async () => {
    const owner = await createTestUser({ email: `as-mo-${Date.now()}@projectflow.test` });
    const t = owner.accessToken;
    const ws = await createTestWorkspace(t);
    const space = await createTestProject(ws.Id, t, { name: 'P', key: `PP${Date.now() % 100000}` });
    const folder = await mkFolder(ws.Id, space.Id, t, 'F');
    const list = await mkList(ws.Id, space.Id, folder.id, t, 'L');

    const member = await createTestUser({ email: `as-mem-${Date.now()}@projectflow.test` });
    await request(`/workspaces/${ws.Id}/members`, {
      method: 'POST', token: t, json: { userId: member.user.Id, role: 'MEMBER' },
    });

    const scopes = await accessibleScopes(member.user.Id, ws.Id);
    // EDIT floor → every node in a PUBLIC space is visible.
    expect(scopes.has(KEY({ type: 'SPACE', id: space.Id }))).toBe(true);
    expect(scopes.has(KEY(folder))).toBe(true);
    expect(scopes.has(KEY(list))).toBe(true);
    expect(scopes.size).toBe(3);
  });
});

/**
 * ROLE arm: a scope node granted via SubjectType='ROLE' to a custom workspace
 * role is visible ONLY to members that hold that role (via dbo.UserRoles).
 */
describe('usp_AccessibleScopes_ForUser — ROLE-based ObjectPermissions grant', () => {
  it('non-member granted a custom role sees the role-granted list in PRIVATE space; sibling and space remain hidden', async () => {
    const owner = await createTestUser({ email: `rb-owner-${Date.now()}@projectflow.test` });
    const t = owner.accessToken;
    const ws = await createTestWorkspace(t);

    // PRIVATE space — only explicit grants expose nodes to non-members.
    const spacePriv = await createTestProject(ws.Id, t, { name: 'RBPriv', key: `RBP${Date.now() % 100000}` });
    await setVisibility(spacePriv.Id, 'PRIVATE');
    const lGranted = await mkList(ws.Id, spacePriv.Id, null, t, 'RB-Granted');
    const lSibling = await mkList(ws.Id, spacePriv.Id, null, t, 'RB-Sibling');

    // A user who is NOT in WorkspaceMembers — floor is NULL, PRIVATE exclusion
    // fires unless HasExplicit = 1. This isolates the ROLE arm as the only
    // path that can surface a node.
    const roleUser = await createTestUser({ email: `rb-role-${Date.now()}@projectflow.test` });

    // Confirm: without any grant the user sees nothing.
    const scopesBefore = await accessibleScopes(roleUser.user.Id, ws.Id);
    expect(scopesBefore.size).toBe(0);

    // Seed: custom workspace role → assign to roleUser → grant VIEW on lGranted only.
    const pool = await getPool();
    const roleId: string = (
      await pool.request()
        .input('wsId', sql.UniqueIdentifier, ws.Id)
        .query(`
          INSERT INTO dbo.Roles (Name, Slug, Scope, WorkspaceId)
          OUTPUT INSERTED.Id
          VALUES ('AI Reader', 'ai-reader-${Date.now()}', 'WORKSPACE', @wsId)
        `)
    ).recordset[0].Id;

    await pool.request()
      .input('userId', sql.UniqueIdentifier, roleUser.user.Id)
      .input('roleId', sql.UniqueIdentifier, roleId)
      .input('wsId', sql.UniqueIdentifier, ws.Id)
      .query(`
        INSERT INTO dbo.UserRoles (UserId, RoleId, WorkspaceId)
        VALUES (@userId, @roleId, @wsId)
      `);

    await pool.request()
      .input('wsId', sql.UniqueIdentifier, ws.Id)
      .input('roleId', sql.UniqueIdentifier, roleId)
      .input('objId', sql.UniqueIdentifier, lGranted.id)
      .query(`
        INSERT INTO dbo.ObjectPermissions (WorkspaceId, SubjectType, SubjectId, ObjectType, ObjectId, Level)
        VALUES (@wsId, 'ROLE', @roleId, 'LIST', @objId, 'VIEW')
      `);

    // After role grant: lGranted visible, lSibling and spacePriv still hidden.
    const scopesAfter = await accessibleScopes(roleUser.user.Id, ws.Id);
    expect(scopesAfter.has(KEY(lGranted))).toBe(true);                          // role-granted list visible
    expect(scopesAfter.has(KEY(lSibling))).toBe(false);                         // sibling — no grant
    expect(scopesAfter.has(KEY({ type: 'SPACE', id: spacePriv.Id }))).toBe(false); // space itself not granted
    expect(scopesAfter.size).toBe(1);

    // Oracle cross-check: SP must agree exactly with usp_ObjectAccess_Resolve.
    const allNodes = [
      { type: 'SPACE', id: spacePriv.Id },
      { type: 'LIST', id: lGranted.id },
      { type: 'LIST', id: lSibling.id },
    ];
    const oracle = new Set<string>();
    for (const n of allNodes) {
      const r = await resolveOne(roleUser.user.Id, n.type, n.id);
      if (r.Level !== null) oracle.add(KEY(n));
    }
    expect(
      [...scopesAfter].sort(),
      'set SP disagrees with resolver for role-granted non-member',
    ).toEqual([...oracle].sort());
  });
});

/**
 * ORACLE: build a mixed workspace, enumerate ALL scope nodes, and assert the set
 * SP equals EXACTLY the nodes the per-object resolver reports as VIEW-able.
 */
describe('usp_AccessibleScopes_ForUser — oracle cross-check vs usp_ObjectAccess_Resolve', () => {
  it('agrees node-for-node for owner, member, guest, and cross-workspace non-member', async () => {
    const owner = await createTestUser({ email: `or-owner-${Date.now()}@projectflow.test` });
    const t = owner.accessToken;
    const ws = await createTestWorkspace(t);

    // Two spaces: public + private; each with a folder and lists (one nested).
    const pub = await createTestProject(ws.Id, t, { name: 'Pub', key: `PUB${Date.now() % 10000}` });
    const priv = await createTestProject(ws.Id, t, { name: 'Priv', key: `PRV${Date.now() % 10000}` });
    await setVisibility(priv.Id, 'PRIVATE');

    const pubFolder = await mkFolder(ws.Id, pub.Id, t, 'PubF');
    const pubListTop = await mkList(ws.Id, pub.Id, null, t, 'PubTop');
    const pubListNested = await mkList(ws.Id, pub.Id, pubFolder.id, t, 'PubNested');

    const privFolder = await mkFolder(ws.Id, priv.Id, t, 'PrivF');
    const privList1 = await mkList(ws.Id, priv.Id, null, t, 'Priv1');
    const privList2 = await mkList(ws.Id, priv.Id, privFolder.id, t, 'Priv2');

    // All nodes in the workspace (for enumeration).
    const allNodes: Array<{ type: string; id: string }> = [
      { type: 'SPACE', id: pub.Id }, { type: 'SPACE', id: priv.Id },
      { type: 'FOLDER', id: pubFolder.id }, { type: 'FOLDER', id: privFolder.id },
      { type: 'LIST', id: pubListTop.id }, { type: 'LIST', id: pubListNested.id },
      { type: 'LIST', id: privList1.id }, { type: 'LIST', id: privList2.id },
    ];

    // A regular member (EDIT floor).
    const member = await createTestUser({ email: `or-mem-${Date.now()}@projectflow.test` });
    await request(`/workspaces/${ws.Id}/members`, {
      method: 'POST', token: t, json: { userId: member.user.Id, role: 'MEMBER' },
    });

    // A guest granted VIEW on the nested PRIVATE list only — exercises the
    // ancestor-folder prefix arm AND the guest-no-floor branch.
    const guest = await inviteGuest(t, ws.Id, `or-guest-${Date.now()}@vendor.io`, {
      objectType: 'LIST', objectId: privList2.id, level: 'VIEW',
    });

    // A cross-workspace non-member: belongs to a DIFFERENT workspace.
    const stranger = await createTestUser({ email: `or-str-${Date.now()}@projectflow.test` });
    await createTestWorkspace(stranger.accessToken); // their own ws; not a member of `ws`

    async function oracleSet(userId: string): Promise<Set<string>> {
      const out = new Set<string>();
      for (const n of allNodes) {
        const r = await resolveOne(userId, n.type, n.id);
        if (r.Level !== null) out.add(KEY(n));
      }
      return out;
    }

    for (const subject of [
      { label: 'owner', id: owner.user.Id },
      { label: 'member', id: member.user.Id },
      { label: 'guest', id: guest.id },
      { label: 'stranger', id: stranger.user.Id },
    ]) {
      const sp = await accessibleScopes(subject.id, ws.Id);
      const oracle = await oracleSet(subject.id);
      expect(
        [...sp].sort(),
        `set SP disagrees with resolver for ${subject.label}`,
      ).toEqual([...oracle].sort());
    }

    // Spot-check the guest expectation explicitly: ONLY the nested private list.
    const guestScopes = await accessibleScopes(guest.id, ws.Id);
    expect([...guestScopes]).toEqual([KEY({ type: 'LIST', id: privList2.id })]);

    // Stranger sees nothing.
    expect((await accessibleScopes(stranger.user.Id, ws.Id)).size).toBe(0);
  });
});
