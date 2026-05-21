// Drive the /setup form to create the first workspace + project (sets pf_sel
// selection cookie). Saves refreshed storageState. Run: node e2e/_smoke/setup-ui.mjs
import { chromium } from '@playwright/test';

const OUT = 'e2e/_smoke';
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ storageState: `${OUT}/state.json`, baseURL: 'http://localhost:3000', viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto('/setup');
await page.waitForLoadState('networkidle').catch(() => {});
if (page.url().includes('/setup')) {
  await page.getByLabel(/workspace name/i).fill('Smoke WS');
  await page.getByLabel(/project name/i).fill('Smoke Project');
  await page.getByRole('button', { name: /create and continue/i }).click();
  await page.waitForURL((u) => !u.pathname.includes('/setup'), { timeout: 20_000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
} else {
  console.log('NOTE: /setup redirected (workspace already exists)');
}

console.log('AFTER SETUP URL:', page.url());
const cookies = (await ctx.cookies()).map((c) => `${c.name}=${c.value.slice(0, 24)}${c.value.length > 24 ? '…' : ''}`);
console.log('COOKIES:', cookies.join('  '));
await page.screenshot({ path: `${OUT}/01-after-setup.png`, fullPage: true });
await ctx.storageState({ path: `${OUT}/state.json` });
console.log('CONSOLE ERRORS:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
await browser.close();
