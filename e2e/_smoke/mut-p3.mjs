// Phase 3 mutation smoke: TaskDrawer Server Actions (comments add, priority
// change, sections render) + logout Server Action. Run: node e2e/_smoke/mut-p3.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = 'e2e/_smoke/p3';
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ storageState: 'e2e/_smoke/state.json', baseURL: 'http://localhost:3000', viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

// ── Open a task card on the board → TaskDrawer ─────────────────────────────
await page.goto('/board');
await page.waitForLoadState('networkidle').catch(() => {});
const candidates = ['Design login screen', 'Fix board drag bug', 'Set up CI pipeline', 'Add dark mode', 'Write API docs', 'Smoke created card'];
let opened = false;
for (const t of candidates) {
  const el = page.getByText(t, { exact: true }).first();
  if (await el.isVisible().catch(() => false)) {
    await el.click().catch(() => {});
    if (await page.locator('[role="dialog"]').first().isVisible({ timeout: 4000 }).catch(() => false)) {
      log('DRAWER opened via card:', t);
      opened = true;
      break;
    }
  }
}
if (!opened) log('DRAWER: could not open a card from candidates');
await page.waitForTimeout(2500); // let comment/worklog/attachment/PR server actions resolve

// ── Sections render? (G1–G4) ───────────────────────────────────────────────
for (const h of ['Comments', 'Time Tracking', 'Attachments', 'Pull Requests']) {
  const seen = await page.getByText(h, { exact: false }).first().isVisible().catch(() => false);
  log(`SECTION "${h}":`, seen ? 'rendered' : 'MISSING');
}
await page.screenshot({ path: `${OUT}/drawer-open.png`, fullPage: true });

// ── Add a comment (G1: addComment + loadComments) ──────────────────────────
const body = 'P3 smoke comment ' + Date.now();
const cta = page.getByPlaceholder('Add a comment…');
if (await cta.isVisible().catch(() => false)) {
  await cta.fill(body);
  await page.getByRole('button', { name: /^comment$/i }).click().catch(() => {});
  await page.waitForTimeout(2000);
  const commentSeen = await page.getByText(body, { exact: false }).isVisible().catch(() => false);
  log('COMMENT add → visible:', commentSeen);
} else {
  log('COMMENT: textarea not found');
}

// ── Change priority (G5: updateTaskFields) ─────────────────────────────────
const prio = page.locator('select[aria-label="Priority"]');
if (await prio.isVisible().catch(() => false)) {
  const before = await prio.inputValue().catch(() => '?');
  const next = before === 'HIGH' ? 'LOW' : 'HIGH';
  await prio.selectOption(next).catch(() => {});
  await page.waitForTimeout(1800);
  const after = await prio.inputValue().catch(() => '?');
  log(`PRIORITY change: ${before} → ${after} (wanted ${next})`);
} else {
  log('PRIORITY: select not found');
}
await page.screenshot({ path: `${OUT}/drawer-after-mutations.png`, fullPage: true });

// close drawer
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(500);

log('\nDRAWER+MUTATION CONSOLE ERRORS:', errs.length ? JSON.stringify(errs, null, 2) : 'none');

// ── Logout (J2: logout Server Action → /login) ─────────────────────────────
errs.length = 0;
await page.goto('/board');
await page.waitForLoadState('networkidle').catch(() => {});
// open the user dropdown (avatar/initials trigger in the topbar)
const trigger = page.locator('header button[aria-label$="menu"], header img[alt]').last();
await trigger.click({ timeout: 5000 }).catch((e) => log('LOGOUT: trigger click', e.message));
await page.waitForTimeout(400);
await page.getByRole('button', { name: /^logout$/i }).click({ timeout: 5000 }).catch((e) => log('LOGOUT: button', e.message));
await page.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 10_000 }).catch(() => {});
log('LOGOUT landed:', page.url());
await page.screenshot({ path: `${OUT}/after-logout.png`, fullPage: true });
log('LOGOUT CONSOLE ERRORS:', errs.length ? JSON.stringify(errs, null, 2) : 'none');

await browser.close();
