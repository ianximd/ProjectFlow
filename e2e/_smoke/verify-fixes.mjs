// Verify the two fixes: (1) workspace slug pattern no longer throws the v-flag
// regex console error; (2) /admin shows a clean not-authorized panel + the
// Admin nav item is hidden for a non-admin. Run: node e2e/_smoke/verify-fixes.mjs
import { chromium } from '@playwright/test';

const OUT = 'e2e/_smoke/mutate';
const WS = 'DDFDF2B7-0BEB-46F4-B691-56D94BC244A5';
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ storageState: 'e2e/_smoke/state.json', baseURL: 'http://localhost:3000', viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

// 1. Slug pattern — ws-settings renders the slug input directly on load.
await page.goto(`/workspaces/${WS}/settings`);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(800);
const slugErrs = errs.filter((e) => /pattern attribute/i.test(e));
console.log('SLUG pattern console errors (expect 0):', slugErrs.length, JSON.stringify(slugErrs));

// 2. Admin nav hidden for non-admin (wait for the client permissions fetch).
await page.goto('/board');
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(2000);
const adminLink = await page.getByRole('link', { name: 'Admin' }).count().catch(() => -1);
console.log('Admin nav link count (expect 0 for non-admin):', adminLink);
await page.screenshot({ path: `${OUT}/fix-sidebar.png`, fullPage: true });

// 3. /admin graceful not-authorized (no crash boundary).
const before = errs.length;
await page.goto('/admin');
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(1000);
const forbidden = await page.getByText(/admin access required/i).isVisible().catch(() => false);
const crash = await page.getByText(/this page couldn.?t load|a server error occurred/i).isVisible().catch(() => false);
console.log('/admin not-authorized panel:', forbidden, '| crash boundary:', crash);
console.log('/admin new console errors:', JSON.stringify(errs.slice(before)));
await page.screenshot({ path: `${OUT}/fix-admin.png`, fullPage: true });

console.log('\nALL CONSOLE ERRORS:', errs.length ? JSON.stringify(errs, null, 2) : 'none');
await browser.close();
