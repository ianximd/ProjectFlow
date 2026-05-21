// Phase 3.1 live smoke — verifies:
//   M3) NO React hydration mismatch on /projects + /roadmap under an id-ID
//       browser locale (the reported repro: en-US server vs id-ID client).
//   L4) workspace/project switcher + TaskDrawer still work after the zustand
//       selection bridge was retired (cookie/server-props are sole truth).
//   N2-neg) the non-admin smoke user sees NO Admin link and /admin is gated.
// Run: node e2e/_smoke/p31-smoke.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const EMAIL = process.env.SMOKE_EMAIL || 'smoke1@projectflow.test';
const PW = process.env.SMOKE_PW || 'SmokePass123!';
const OUT = 'e2e/_smoke/p31';
mkdirSync(OUT, { recursive: true });

const HYDRATION_RE = /hydrat|did not match|text content does not match|server-rendered HTML/i;
const results = [];
const pass = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

const browser = await chromium.launch({ channel: 'chrome' });
// id-ID locale = the reported hydration-mismatch condition.
const ctx = await browser.newContext({
  baseURL: 'http://localhost:3000',
  viewport: { width: 1440, height: 900 },
  locale: 'id-ID',
  timezoneId: 'Asia/Jakarta',
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));

// ── Login ──────────────────────────────────────────────────────────────────
await page.goto('/login');
await page.locator('#email').fill(EMAIL);
await page.locator('#password').fill(PW);
await page.getByRole('button', { name: /sign in/i }).click();
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
await page.waitForLoadState('networkidle').catch(() => {});
const loggedIn = !page.url().includes('/login');
pass('login (non-admin smoke user)', loggedIn, page.url());
if (!loggedIn) { console.log('CONSOLE ERRORS:', JSON.stringify(consoleErrors, null, 2)); await browser.close(); process.exit(1); }

// ── M3: hydration check on /projects and /roadmap (fresh full loads) ─────────
for (const path of ['/projects', '/roadmap']) {
  consoleErrors.length = 0;
  await page.goto(path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200); // let hydration settle
  await page.screenshot({ path: `${OUT}/${path.slice(1)}.png`, fullPage: true });
  const hydrationErrs = consoleErrors.filter((e) => HYDRATION_RE.test(e));
  pass(`no hydration mismatch on ${path} (id-ID locale)`, hydrationErrs.length === 0,
    hydrationErrs.length ? JSON.stringify(hydrationErrs) : `${consoleErrors.length} other console error(s)`);
  if (consoleErrors.length) console.log(`  [${path}] all console errors:`, JSON.stringify(consoleErrors, null, 2));
}

// ── L4 (a): TaskDrawer on the DEFAULT (populated) board — test BEFORE switching
// so we click a card on a workspace that has data. The TaskDrawer is uniquely
// identifiable by its day-granular <input type="date"> Start/Due fields.
consoleErrors.length = 0;
await page.goto('/board', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
let drawerOk = false;
const cardTitle = page.locator('.line-clamp-2').first(); // TaskCard title div (clicks bubble to the card)
const cardCount = await cardTitle.count();
console.log(`  /board cards found: ${cardCount}`);
if (cardCount > 0) {
  await cardTitle.click().catch(() => {});
  await page.waitForTimeout(1000);
  drawerOk = (await page.locator('input[type="date"]').count()) > 0;
  await page.screenshot({ path: `${OUT}/board-drawer.png`, fullPage: true });
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
}
pass('task drawer opens (workspaceId prop path)', drawerOk,
  drawerOk ? 'drawer date inputs rendered' : `no card/drawer (cards=${cardCount})`);

// ── L4 (b): workspace/project switcher re-renders server data ────────────────
// Workspace switcher only renders when >1 workspace; project switcher when projects exist.
const triggers = page.locator('button[role="combobox"], [data-slot="select-trigger"]');
const triggerCount = await triggers.count();
console.log(`  /board select triggers found: ${triggerCount}`);
let switched = false;
if (triggerCount > 0) {
  const before = await page.content();
  await triggers.first().click().catch(() => {});
  await page.waitForTimeout(400);
  const options = page.locator('[role="option"]');
  const optCount = await options.count();
  console.log(`  switcher options: ${optCount}`);
  if (optCount > 1) {
    await options.nth(1).click().catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(800);
    switched = (await page.content()) !== before;
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }
}
pass('workspace/project switch re-renders', switched,
  switched ? 'content changed after switch' : `not exercised (triggers=${triggerCount}; single-option account?)`);

// ── N2-neg: non-admin must NOT see Admin link, /admin gated ──────────────────
await page.goto('/board', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const adminLink = page.locator('a[href="/admin"], a[href*="/admin"]');
const adminLinkVisible = (await adminLink.count()) > 0 && await adminLink.first().isVisible().catch(() => false);
pass('non-admin: Admin link hidden', !adminLinkVisible, adminLinkVisible ? 'admin link visible!' : 'hidden as expected');
await page.goto('/admin', { waitUntil: 'networkidle' }).catch(() => {});
await page.waitForTimeout(800);
const adminUrl = page.url();
// Server-side guard renders an "Admin access required" panel (no admin data) —
// it does NOT redirect, so the URL stays /admin. Detect the panel copy.
const gateText = await page.locator('text=/admin access required|permission to view|forbidden|not authorized|access denied|403/i').count();
const adminGated = !adminUrl.endsWith('/admin') || gateText > 0;
await page.screenshot({ path: `${OUT}/admin-nonadmin.png`, fullPage: true });
pass('non-admin: /admin gated (not-authorized panel)', adminGated, `landed ${adminUrl}; gateText=${gateText}`);

// ── Summary ──────────────────────────────────────────────────────────────────
await ctx.storageState({ path: `${OUT}/state.json` });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n=== P3.1 SMOKE: ${results.length - failed.length}/${results.length} PASS ===`);
if (failed.length) { console.log('FAILED:', failed.map((f) => f.name).join('; ')); process.exit(2); }
