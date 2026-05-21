// Mutation batch 2: deleteTask (board), createVersion, createLabel, updateProfile.
// Run: node e2e/_smoke/more-mutations.mjs
import { chromium } from '@playwright/test';

const OUT = 'e2e/_smoke/mutate';
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ storageState: 'e2e/_smoke/state.json', baseURL: 'http://localhost:3000', viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
const step = async (name, fn) => { try { const r = await fn(); console.log(`[${name}] OK ${r ?? ''}`); } catch (e) { console.log(`[${name}] FAIL ${e.message.slice(0, 120)}`); } };

// ── deleteTask on board (delete "Smoke created card") ─────────────────────
await step('board-delete', async () => {
  await page.goto('/board');
  await page.waitForLoadState('networkidle').catch(() => {});
  const before = await page.getByText(/Showing \d+ of \d+/).innerText();
  await page.getByRole('button', { name: 'Delete Smoke created card' }).click();
  await page.waitForTimeout(800);
  // confirm dialog if present
  const confirm = page.getByRole('button', { name: /^(delete|confirm|yes)/i });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await page.waitForTimeout(2500);
  const after = await page.getByText(/Showing \d+ of \d+/).innerText();
  const gone = !(await page.getByText('Smoke created card', { exact: true }).isVisible().catch(() => false));
  await page.screenshot({ path: `${OUT}/board-after-delete.png`, fullPage: true });
  return `before=${before} after=${after} gone=${gone}`;
});

// ── createVersion ─────────────────────────────────────────────────────────
await step('version-create', async () => {
  await page.goto('/versions');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.getByRole('button', { name: /new version/i }).click();
  await page.locator('#v-name').fill('v1.0.0-smoke');
  await page.getByRole('button', { name: /create version/i }).click();
  await page.waitForTimeout(2500);
  const ok = await page.getByText('v1.0.0-smoke', { exact: false }).first().isVisible().catch(() => false);
  await page.screenshot({ path: `${OUT}/versions-after-create.png`, fullPage: true });
  return `visible=${ok}`;
});

// ── createLabel ───────────────────────────────────────────────────────────
await step('label-create', async () => {
  await page.goto('/project-settings');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.getByRole('button', { name: /new label/i }).click();
  await page.locator('#lbl-name').fill('smoke-label');
  await page.getByRole('button', { name: /create label/i }).click();
  await page.waitForTimeout(2500);
  const ok = await page.getByText('smoke-label', { exact: false }).first().isVisible().catch(() => false);
  await page.screenshot({ path: `${OUT}/labels-after-create.png`, fullPage: true });
  return `visible=${ok}`;
});

// ── updateProfile (name) ──────────────────────────────────────────────────
await step('profile-name', async () => {
  await page.goto('/settings/profile');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.locator('#profile-name').fill('Smoke Tester Edited');
  await page.getByRole('button', { name: /^save/i }).first().click();
  await page.waitForTimeout(2500);
  await page.reload();
  await page.waitForLoadState('networkidle').catch(() => {});
  const val = await page.locator('#profile-name').inputValue().catch(() => '?');
  await page.screenshot({ path: `${OUT}/profile-after-save.png`, fullPage: true });
  return `persisted name=${JSON.stringify(val)}`;
});

console.log('\nCONSOLE ERRORS:', errs.length ? JSON.stringify(errs, null, 2) : 'none');
await browser.close();
