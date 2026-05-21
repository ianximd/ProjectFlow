// Smoke-test helper: log in via the real UI, save storageState for reuse.
// Run: node e2e/_smoke/login.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const EMAIL = process.env.SMOKE_EMAIL || 'smoke1@projectflow.test';
const PW = process.env.SMOKE_PW || 'SmokePass123!';
const OUT = 'e2e/_smoke';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ baseURL: 'http://localhost:3000', viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto('/login');
await page.locator('#email').fill(EMAIL);
await page.locator('#password').fill(PW);
await page.getByRole('button', { name: /sign in/i }).click();
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
await page.waitForLoadState('networkidle').catch(() => {});

console.log('LANDED:', page.url());
await page.screenshot({ path: `${OUT}/00-landing.png`, fullPage: true });
await ctx.storageState({ path: `${OUT}/state.json` });
console.log('CONSOLE ERRORS:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
await browser.close();
