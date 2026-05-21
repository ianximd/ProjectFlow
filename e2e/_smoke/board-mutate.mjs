// Mutation tests for server-action write path: board create, board drag
// (cross-column + persistence), and workspace create.
// Run: node e2e/_smoke/board-mutate.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = 'e2e/_smoke/mutate';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ storageState: 'e2e/_smoke/state.json', baseURL: 'http://localhost:3000', viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
const log = (...a) => console.log(...a);

// ── 1. BOARD CREATE (To Do column) ────────────────────────────────────────
await page.goto('/board');
await page.waitForLoadState('networkidle').catch(() => {});
const showingBefore = await page.getByText(/Showing \d+ of \d+/).innerText().catch(() => '?');
log('CREATE: showing before =', showingBefore);
await page.getByRole('button', { name: /create issue in to do/i }).click();
const ta = page.getByPlaceholder('What needs to be done?');
await ta.fill('Smoke created card');
await ta.press('Enter');
await page.waitForTimeout(2500);
const cardVisible = await page.getByText('Smoke created card', { exact: true }).isVisible().catch(() => false);
const showingAfter = await page.getByText(/Showing \d+ of \d+/).innerText().catch(() => '?');
log('CREATE: card visible =', cardVisible, '| showing after =', showingAfter);
await page.screenshot({ path: `${OUT}/board-after-create.png`, fullPage: true });

// ── 2. BOARD DRAG (To Do → In Progress) + persistence ─────────────────────
const inProgBtn = page.getByRole('button', { name: /create issue in in progress/i });
const ipHeader = page.getByText('IN PROGRESS', { exact: false }).first();
const ipCountBefore = await ipHeader.innerText().catch(() => '?');
log('DRAG: In Progress header before =', ipCountBefore);

const card = page.getByText('Write API docs', { exact: true });
const cb = await card.boundingBox();
const targetBox = await inProgBtn.boundingBox();
if (cb && targetBox) {
  const dropX = targetBox.x + targetBox.width / 2;
  const dropY = targetBox.y - 80; // into the In Progress column body, above its create button
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2 - 6, { steps: 4 }); // trip dnd activation
  await page.mouse.move(dropX, dropY, { steps: 20 });
  await page.mouse.move(dropX, dropY + 10, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(3000);
} else {
  log('DRAG: could not get bounding boxes', { cb: !!cb, targetBox: !!targetBox });
}
const ipCountAfter = await ipHeader.innerText().catch(() => '?');
log('DRAG: In Progress header after =', ipCountAfter);
await page.screenshot({ path: `${OUT}/board-after-drag.png`, fullPage: true });

// persistence: hard reload, check the card is under In Progress
await page.reload();
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(1500);
const ipCountReload = await page.getByText('IN PROGRESS', { exact: false }).first().innerText().catch(() => '?');
log('DRAG: In Progress header after reload =', ipCountReload);
await page.screenshot({ path: `${OUT}/board-after-reload.png`, fullPage: true });

// ── 3. WORKSPACE CREATE (known selectors) ─────────────────────────────────
await page.goto('/workspaces');
await page.waitForLoadState('networkidle').catch(() => {});
await page.getByRole('button', { name: /new workspace/i }).click().catch((e) => log('WS: new workspace btn', e.message));
await page.locator('#ws-name').fill('Mutation WS').catch((e) => log('WS: name', e.message));
await page.locator('#ws-slug').fill('mutation-ws-' + Date.now()).catch(() => {});
await page.getByRole('button', { name: /create workspace/i }).click().catch((e) => log('WS: create btn', e.message));
await page.waitForTimeout(2500);
const wsVisible = await page.getByText('Mutation WS', { exact: true }).isVisible().catch(() => false);
log('WS CREATE: visible =', wsVisible);
await page.screenshot({ path: `${OUT}/ws-after-create.png`, fullPage: true });

log('\nCONSOLE ERRORS:', errs.length ? JSON.stringify(errs, null, 2) : 'none');
await browser.close();
