import { test, expect, request as pwRequest } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';
const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

/**
 * Phase 10d — Guests. Invite an external user to ONE List, accept as the guest,
 * confirm they are taken to that List and that the Space + sibling List are
 * denied (resolver no-floor + tree filter). API checks are the authoritative
 * isolation proof; the UI redirect proves the accept landing works.
 * DB SAFETY: runs against local Docker ProjectFlow_Test (export the local DB env).
 */
test('guest invited to one List reaches only it; Space + sibling denied', async ({ page }) => {
  const s = uniq();
  const ownerEmail = `g-owner-${s}@projectflow.test`;
  const guestEmail = `g-ext-${s}@vendor.io`;        // external domain → stays a guest
  const password = 'E2EPass123!';

  const api = await pwRequest.newContext();
  // Owner + workspace + space + two lists.
  await api.post(`${API_BASE}/auth/register`, { data: { email: ownerEmail, name: `O ${s}`, password } });
  const { data: { token } } = await (await api.post(`${API_BASE}/auth/login`, { data: { email: ownerEmail, password } })).json();
  const auth = { Authorization: `Bearer ${token}` };
  const ws = await (await api.post(`${API_BASE}/workspaces`, { headers: auth, data: { name: `WS ${s}`, slug: `ws-${s}` } })).json();
  const wsId = ws.data.Id;
  const space = await (await api.post(`${API_BASE}/projects`, { headers: auth, data: { workspaceId: wsId, name: `Space ${s}`, key: `SP${s.slice(-4)}`, type: 'KANBAN' } })).json();
  const spaceId = space.data.Id;
  const mkList = async (name: string) => {
    const r = await (await api.post(`${API_BASE}/lists`, { headers: auth, data: { workspaceId: wsId, spaceId, folderId: null, name, position: 0 } })).json();
    const d = r.data; return (d.id ?? d.Id) as string;
  };
  const sharedId = await mkList(`Shared ${s}`);
  const hiddenId = await mkList(`Hidden ${s}`);

  // Register the guest user (so accept can match their email) and invite them to the shared List.
  await api.post(`${API_BASE}/auth/register`, { data: { email: guestEmail, name: `G ${s}`, password } });
  const invite = await (await api.post(`${API_BASE}/guests/invites`, {
    headers: auth, data: { workspaceId: wsId, email: guestEmail, objectType: 'LIST', objectId: sharedId, level: 'VIEW' },
  })).json();
  expect(invite.role).toBe('workspace-guest');
  const inviteToken = invite.invite.token as string;

  // Log in as the guest in the browser, accept via the landing route (redirects to the granted List).
  await page.goto('/login');
  await page.locator('#email').fill(guestEmail);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });

  await page.goto(`/guests/accept/${inviteToken}`);
  // Accept redirects to /lists/:sharedId — proves accept succeeded AND the guest reaches the granted List.
  await page.waitForURL((u) => u.pathname.includes(`/lists/${sharedId}`), { timeout: 15000 });
  expect(page.url()).toContain(`/lists/${sharedId}`);

  // Authoritative isolation checks as the guest (Bearer; the web app keeps the session in cookies).
  const guestApi = await pwRequest.newContext();
  const { data: { token: gtoken } } = await (await guestApi.post(`${API_BASE}/auth/login`, { data: { email: guestEmail, password } })).json();
  const gauth = { Authorization: `Bearer ${gtoken}` };

  const okShared = await guestApi.get(`${API_BASE}/lists/${sharedId}/effective-statuses`, { headers: gauth });
  expect(okShared.status()).toBe(200);                      // granted List → visible
  const sibling = await guestApi.get(`${API_BASE}/lists/${hiddenId}/effective-statuses`, { headers: gauth });
  expect(sibling.status()).toBe(403);                       // sibling List → denied
  const spaceGet = await guestApi.get(`${API_BASE}/projects/${spaceId}`, { headers: gauth });
  expect(spaceGet.status()).toBe(403);                      // Space record → denied (direct fetch)
  const enumerate = await guestApi.get(`${API_BASE}/lists?spaceId=${spaceId}`, { headers: gauth });
  expect(enumerate.status()).toBe(403);                     // cannot enumerate the Space tree

  await api.dispose();
  await guestApi.dispose();
});
