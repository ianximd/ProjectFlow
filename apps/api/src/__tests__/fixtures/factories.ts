/**
 * Test fixtures — scaffold a known user / workspace / project / task graph
 * via the in-process Hono app, with a side door for granting system roles
 * (super-admin) that the public API doesn't expose to anonymous users.
 *
 * Designed for `beforeEach` use: every helper is independent, returns
 * stable handles, and never mutates state owned by another test.
 */

import { request, json } from '../setup/testServer.js';
import { getPool } from '../../shared/lib/db.js';

let counter = 0;
function uniq(prefix: string): string {
  counter += 1;
  return `${prefix}-${process.pid}-${Date.now()}-${counter}`;
}

export type SystemRole    = 'super-admin' | 'user-admin' | 'auditor';
export type WorkspaceRole = 'workspace-owner' | 'workspace-admin' | 'workspace-member' | 'workspace-viewer';

export interface TestUserHandle {
  user:         { Id: string; Email: string; Name: string };
  accessToken:  string;
  refreshToken: string | null;
  password:     string;
}

export async function createTestUser(opts: {
  email?:      string;
  name?:       string;
  password?:   string;
  systemRole?: SystemRole;
} = {}): Promise<TestUserHandle> {
  const email    = opts.email    ?? `${uniq('user')}@projectflow.test`;
  const name     = opts.name     ?? 'Test User';
  const password = opts.password ?? 'TestPass123!';

  const reg = await request('/auth/register', { method: 'POST', json: { email, name, password } });
  const regBody = await json<{ data: { Id: string; Email: string; Name: string } }>(reg, 201);

  const login = await request('/auth/login', { method: 'POST', json: { email, password } });
  const loginBody = await json<{ data: { token: string; user: any } }>(login, 200);

  // Optional system-role grant. The public API would refuse to do this
  // before any super-admin exists, so we go straight to the SP — same
  // path the env-admin bootstrap uses.
  if (opts.systemRole) {
    await grantSystemRole(regBody.data.Id, opts.systemRole);
  }

  return {
    user:         regBody.data,
    accessToken:  loginBody.data.token,
    refreshToken: extractRefreshCookie(login),
    password,
  };
}

export async function grantSystemRole(userId: string, slug: SystemRole): Promise<void> {
  const pool = await getPool();
  await pool.request()
    .input('UserId',   userId)
    .input('RoleSlug', slug)
    .execute('usp_UserRole_AssignBySlug');
}

export interface TestWorkspaceHandle {
  Id:    string;
  Name:  string;
  Slug:  string;
}

export async function createTestWorkspace(token: string, name?: string): Promise<TestWorkspaceHandle> {
  const ws = await request('/workspaces', {
    method: 'POST',
    token,
    json:   { name: name ?? 'Test Workspace', slug: uniq('test-ws') },
  });
  const body = await json<{ data: TestWorkspaceHandle }>(ws, 201);
  return body.data;
}

export interface TestProjectHandle {
  Id:           string;
  WorkspaceId:  string;
  Key:          string;
  Name:         string;
}

export async function createTestProject(
  workspaceId: string,
  token:       string,
  opts:        { name?: string; key?: string } = {},
): Promise<TestProjectHandle> {
  const key = (opts.key ?? `T${Date.now().toString(36).slice(-5)}`).toUpperCase();
  const prj = await request('/projects', {
    method: 'POST',
    token,
    json:   { workspaceId, name: opts.name ?? 'Test Project', key, type: 'KANBAN' },
  });
  const body = await json<{ data: TestProjectHandle }>(prj, 201);
  return body.data;
}

export interface TestTaskHandle {
  Id:        string;
  IssueKey:  string;
  Title:     string;
  Status:    string;
  ProjectId: string;
}

export async function createTestTask(
  projectId:   string,
  workspaceId: string,
  token:       string,
  opts:        { title?: string; type?: string; status?: string } = {},
): Promise<TestTaskHandle> {
  const t = await request('/tasks', {
    method: 'POST',
    token,
    json:   {
      projectId,
      workspaceId,
      title: opts.title ?? 'Test Task',
      type:  opts.type  ?? 'TASK',
    },
  });
  const body = await json<{ data: TestTaskHandle }>(t, 201);
  return body.data;
}

/** Pull the `refresh_token` cookie value from a Set-Cookie header, if present. */
function extractRefreshCookie(res: Response): string | null {
  const cookie = res.headers.get('set-cookie');
  if (!cookie) return null;
  const match = /refresh_token=([^;]+)/.exec(cookie);
  return match ? decodeURIComponent(match[1]!) : null;
}
