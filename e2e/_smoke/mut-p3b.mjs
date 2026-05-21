// Phase 3 smoke part B: integration panels (H) load via Server Actions on tab
// open; admin roles (I) tab presence + roles list load. Run: node e2e/_smoke/mut-p3b.mjs
// NOTE: re-login first if state.json was invalidated by mut-p3's logout.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = 'e2e/_smoke/p3';
mkdirSync(OUT, { recursive: true });
const EMAIL = process.env.SMOKE_EMAIL || 'smoke1@projectflow.test';
const PW = process.env.SMOKE_PW || 'SmokePass123!';
const log = (...a) => console.log(...a);

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ baseURL: 'http://localhost:3000', viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

// fresh login (mut-p3 logged out)
await page.goto('/login');
await page.locator('#email').fill(EMAIL);
await page.locator('#password').fill(PW);
await page.getByRole('button', { name: /sign in/i }).click();
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
log('LOGIN landed:', page.url());

// ── H: integration panels load on tab open ─────────────────────────────────
await page.goto('/project-settings');
await page.waitForLoadState('networkidle').catch(() => {});
const tabs = [
  ['git', /^Git$/i, 'Connect a repository'],
  ['webhooks', /webhook/i, 'Outgoing webhooks'],
  ['messaging', /slack|teams|messaging/i, 'Notify Slack'],
];
for (const [slug, tabName, heading] of tabs) {
  errs.length = 0;
  const tab = page.getByRole('tab', { name: tabName }).first();
  if (!(await tab.isVisible().catch(() => false))) { log(`TAB ${slug}: trigger not found`); continue; }
  await tab.click().catch(() => {});
  await page.waitForTimeout(1800); // loader Server Action resolves
  const headingSeen = await page.getByText(heading, { exact: false }).first().isVisible().catch(() => false);
  await page.screenshot({ path: `${OUT}/integ-${slug}.png`, fullPage: true });
  log(`TAB ${slug}: heading="${heading}" rendered=${headingSeen} consoleErrs=${errs.length}` + (errs.length ? ' ' + JSON.stringify(errs.slice(0, 2)) : ''));
}

// ── I: admin roles ─────────────────────────────────────────────────────────
errs.length = 0;
const adminLink = await page.getByRole('link', { name: /^admin$/i }).first().isVisible().catch(() => false);
log('SIDEBAR Admin link visible to this user:', adminLink);
await page.goto('/admin');
await page.waitForLoadState('networkidle').catch(() => {});
const rolesTab = page.getByRole('tab', { name: /roles/i }).first();
const hasRolesTab = await rolesTab.isVisible().catch(() => false);
log('ADMIN Roles tab present:', hasRolesTab);
if (hasRolesTab) {
  await rolesTab.click().catch(() => {});
  await page.waitForTimeout(1800);
  const newRoleBtn = await page.getByRole('button', { name: /new role/i }).isVisible().catch(() => false);
  const tableSeen = await page.locator('table').first().isVisible().catch(() => false);
  log(`ADMIN Roles: newRoleBtn=${newRoleBtn} table=${tableSeen} consoleErrs=${errs.length}` + (errs.length ? ' ' + JSON.stringify(errs.slice(0, 2)) : ''));
} else {
  const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120);
  log('ADMIN (not admin or gated):', body);
}
await page.screenshot({ path: `${OUT}/admin-roles.png`, fullPage: true });

await browser.close();
