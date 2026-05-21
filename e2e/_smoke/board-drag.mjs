// Drag "Write API docs" from To Do -> In Progress using the dnd-kit grip
// handle (aria-label="Drag <title>"). Verify move + persistence after reload.
// Run: node e2e/_smoke/board-drag.mjs
import { chromium } from '@playwright/test';

const OUT = 'e2e/_smoke/mutate';
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ storageState: 'e2e/_smoke/state.json', baseURL: 'http://localhost:3000', viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

await page.goto('/board');
await page.waitForLoadState('networkidle').catch(() => {});

// In Progress column count badge (read text near the IN PROGRESS header)
async function ipCount() {
  return await page.locator('[id^="col-"]').filter({ hasText: 'IN PROGRESS' }).first().innerText().catch(() => '?');
}
console.log('IP before:', JSON.stringify((await ipCount()).replace(/\s+/g, ' ').slice(0, 40)));

const handle = page.getByRole('button', { name: 'Drag Write API docs' });
const target = page.getByRole('button', { name: /create issue in in progress/i });
const hb = await handle.boundingBox();
const tb = await target.boundingBox();
console.log('handle box:', !!hb, 'target box:', !!tb);
if (hb && tb) {
  const sx = hb.x + hb.width / 2, sy = hb.y + hb.height / 2;
  const dx = tb.x + tb.width / 2, dy = tb.y - 90;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 4, sy + 14, { steps: 6 }); // exceed dnd activation distance
  await page.mouse.move(dx, dy, { steps: 25 });
  await page.mouse.move(dx, dy + 8, { steps: 6 });
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.waitForTimeout(3000);
}
console.log('IP after drag:', JSON.stringify((await ipCount()).replace(/\s+/g, ' ').slice(0, 40)));
await page.screenshot({ path: `${OUT}/board-drag2-after.png`, fullPage: true });

await page.reload();
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(1500);
console.log('IP after reload:', JSON.stringify((await ipCount()).replace(/\s+/g, ' ').slice(0, 40)));
await page.screenshot({ path: `${OUT}/board-drag2-reload.png`, fullPage: true });

console.log('CONSOLE ERRORS:', errs.length ? JSON.stringify(errs) : 'none');
await browser.close();
