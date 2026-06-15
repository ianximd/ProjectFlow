/**
 * Phase 10b — THE PERMISSION TEST MATRIX (BUILD_PLAN §5.5 acceptance).
 *
 * Proves usp_ObjectAccess_Resolve resolves the correct level for a TARGET LIST
 * across the full cross-product of:
 *   subject    ∈ { owner, admin, member, viewer, custom-role, guest }
 *   grant      ∈ { none, VIEW@space, VIEW@folder, VIEW@list, COMMENT@list,
 *                  EDIT@list, FULL@list, EDIT@space }
 *   visibility ∈ { PUBLIC, PRIVATE }
 *
 * Headline property: a more-specific explicit grant WINS over the role floor
 * (resolver returns COALESCE(@Explicit, @Floor)); the floor is membership-based
 * (owner→FULL, any member→EDIT, non-member→none); PRIVATE denies a non-member
 * WITHOUT an explicit grant. DB SAFETY: targets local Docker ProjectFlow_Test.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';
import { execSpOne } from '../../../shared/lib/sqlClient.js';
import { accessService } from '../access.service.js';
import { roleService } from '../../roles/role.service.js';

type Level = 'VIEW' | 'COMMENT' | 'EDIT' | 'FULL' | null;
type Subject = 'owner' | 'admin' | 'member' | 'viewer' | 'custom' | 'guest';
type Visibility = 'PUBLIC' | 'PRIVATE';
type GrantSpec =
  | { kind: 'none' }
  | { kind: 'grant'; level: Exclude<Level, null>; node: 'space' | 'folder' | 'list' };

// The membership floor each subject gets (resolver: owner→FULL, any member→EDIT,
// non-member→none). "guest" here is a NON-member of the workspace.
const FLOOR: Record<Subject, Level> = {
  owner: 'FULL', admin: 'EDIT', member: 'EDIT', viewer: 'EDIT', custom: 'EDIT', guest: null,
};

// Every grant scenario applied to the TARGET LIST resolution (single grant each).
const GRANTS: GrantSpec[] = [
  { kind: 'none' },
  { kind: 'grant', level: 'VIEW',    node: 'space'  },
  { kind: 'grant', level: 'VIEW',    node: 'folder' },
  { kind: 'grant', level: 'VIEW',    node: 'list'   },
  { kind: 'grant', level: 'COMMENT', node: 'list'   },
  { kind: 'grant', level: 'EDIT',    node: 'list'   },
  { kind: 'grant', level: 'FULL',    node: 'list'   },
  { kind: 'grant', level: 'EDIT',    node: 'space'  }, // ancestor grant, less specific than a list grant
];

const SUBJECTS: Subject[] = ['owner', 'admin', 'member', 'viewer', 'custom', 'guest'];
const VISIBILITIES: Visibility[] = ['PUBLIC', 'PRIVATE'];

/**
 * Expected resolved level for the LIST = the explicit grant (if any) else the
 * floor. Each scenario applies exactly ONE grant on the list's ancestry, so the
 * most-specific explicit grant equals that grant's level. The explicit grant
 * WINS over the floor (proves most-specific-wins; downgrades a member with
 * VIEW@list, upgrades with FULL@list). PRIVATE never changes a value here:
 * members/owner keep their floor under PRIVATE; a guest with no grant is null
 * under both PUBLIC (no floor) and PRIVATE (denied) — and a guest WITH a grant
 * gets it under both (explicit overrides the PRIVATE deny).
 */
function expected(subject: Subject, g: GrantSpec): Level {
  const explicit: Level = g.kind === 'none' ? null : g.level;
  return explicit ?? FLOOR[subject];
}

let env: {
  ownerToken: string;
  wsId: string;
  spaceId: string; folderId: string; listId: string;
  subjects: Record<Subject, { id: string }>;
};

async function setVisibility(spaceId: string, v: Visibility) {
  await execSpOne('usp_Project_SetVisibility', [
    { name: 'Id',         type: sql.UniqueIdentifier, value: spaceId },
    { name: 'Visibility', type: sql.NVarChar(10),     value: v },
  ]);
}

beforeAll(async () => {
  await truncateAll();
  const owner = await createTestUser({ email: `mx-owner-${Date.now()}@projectflow.test` });
  const ws = await createTestWorkspace(owner.accessToken);
  const space = await createTestProject(ws.Id, owner.accessToken, { name: 'Matrix Space', key: `MX${Date.now() % 100000}` });
  const folder = (await json<{ data: any }>(await request('/folders', {
    method: 'POST', token: owner.accessToken, json: { workspaceId: ws.Id, spaceId: space.Id, name: 'F', position: 0 },
  }), 201)).data;
  const folderId = folder.id ?? folder.Id;
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token: owner.accessToken, json: { workspaceId: ws.Id, spaceId: space.Id, folderId, name: 'L', position: 0 },
  }), 201)).data;
  const listId = list.id ?? list.Id;

  const mk = async (tag: string) => createTestUser({ email: `mx-${tag}-${Date.now()}@projectflow.test` });
  const admin = await mk('admin'), member = await mk('member'), viewer = await mk('viewer'), custom = await mk('custom'), guest = await mk('guest');

  // admin/member/viewer/custom are workspace members (→ EDIT floor); guest is NOT.
  for (const [u, role] of [[admin, 'ADMIN'], [member, 'MEMBER'], [viewer, 'VIEWER'], [custom, 'MEMBER']] as const) {
    await request(`/workspaces/${ws.Id}/members`, { method: 'POST', token: owner.accessToken, json: { userId: u.user.Id, role } });
  }
  // The custom subject additionally holds a workspace custom role (membership still drives the floor).
  const perms = await roleService.listPermissions('WORKSPACE');
  const customRole = await roleService.createWorkspaceRole({
    workspaceId: ws.Id, name: 'Matrix Custom', permissionIds: [perms.find((p) => p.slug === 'task.read')!.id], actorId: owner.user.Id,
  });
  await roleService.assignWorkspaceRole({ workspaceId: ws.Id, userId: custom.user.Id, roleId: customRole.id, actorId: owner.user.Id });

  env = {
    ownerToken: owner.accessToken, wsId: ws.Id,
    spaceId: space.Id, folderId, listId,
    subjects: {
      owner: { id: owner.user.Id }, admin: { id: admin.user.Id }, member: { id: member.user.Id },
      viewer: { id: viewer.user.Id }, custom: { id: custom.user.Id }, guest: { id: guest.user.Id },
    },
  };
});

afterAll(async () => { await closePool(); });

async function clearGrants(subjectId: string) {
  for (const node of [['SPACE', env.spaceId], ['FOLDER', env.folderId], ['LIST', env.listId]] as const) {
    await accessService.removeObjectPermission({
      workspaceId: env.wsId, subjectType: 'USER', subjectId,
      objectType: node[0], objectId: node[1], actorId: env.subjects.owner.id,
    });
  }
}

function nodeId(node: 'space' | 'folder' | 'list'): { type: 'SPACE' | 'FOLDER' | 'LIST'; id: string } {
  if (node === 'space')  return { type: 'SPACE',  id: env.spaceId };
  if (node === 'folder') return { type: 'FOLDER', id: env.folderId };
  return { type: 'LIST', id: env.listId };
}

describe('permission matrix — most-specific-wins over the role floor', () => {
  for (const vis of VISIBILITIES) {
    describe(`visibility=${vis}`, () => {
      beforeAll(async () => { await setVisibility(env.spaceId, vis); });

      for (const subject of SUBJECTS) {
        for (const g of GRANTS) {
          const label = g.kind === 'none' ? 'no-grant' : `${g.level}@${g.node}`;
          it(`${subject} × ${label} → ${expected(subject, g) ?? 'NONE'}`, async () => {
            const subjectId = env.subjects[subject].id;
            await clearGrants(subjectId);
            if (g.kind === 'grant') {
              const n = nodeId(g.node);
              await accessService.setObjectPermission({
                workspaceId: env.wsId, subjectType: 'USER', subjectId,
                objectType: n.type, objectId: n.id, level: g.level, actorId: env.subjects.owner.id,
              });
            }
            const { level } = await accessService.resolveOrNull(subjectId, 'LIST', env.listId);
            expect(level).toBe(expected(subject, g));
          });
        }
      }
    });
  }
});
