// Remaining mutations batch 3: dashboard sprint switch, projects open,
// backlog priority/add/delete, epics create + drawer.
// Run: node e2e/_smoke/mut3.mjs
import { chromium } from '@playwright/test';

const OUT = 'e2e/_smoke/mutate';
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ storageState: 'e2e/_smoke/state.json', baseURL: 'http://localhost:3000', viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept().catch(() => {})); // accept window.confirm for delete
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
const step = async (name, fn) => { try { const r = await fn(); console.log(`[${name}] OK ${r ?? ''}`); } catch (e) { console.log(`[${name}] FAIL ${String(e.message).slice(0, 140)}`); } };

await step('dashboard-sprint', async () => {
  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle').catch(() => {});
  const triggers = page.getByRole('combobox');
  const n = await triggers.count();
  let trig = null, before = '';
  for (let i = 0; i < n; i++) { const tx = await triggers.nth(i).innerText().catch(() => ''); if (/Sprint\s*\d/i.test(tx)) { trig = triggers.nth(i); before = tx.replace(/\s+/g, ' ').trim(); break; } }
  if (!trig) return `no sprint combobox (count=${n})`;
  await trig.click();
  await page.waitForTimeout(400);
  const opts = page.getByRole('option');
  const oc = await opts.count();
  let picked = '';
  for (let i = 0; i < oc; i++) { const tx = (await opts.nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ').trim(); if (/Sprint\s*\d/i.test(tx) && !before.includes(tx.split('·')[0].trim())) { picked = tx; await opts.nth(i).click(); break; } }
  await page.waitForTimeout(2500);
  const after = (await trig.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  await page.screenshot({ path: `${OUT}/dashboard-sprint-switch.png`, fullPage: true });
  return `before="${before}" picked="${picked}" after="${after}" url=${page.url().replace('http://localhost:3000', '')}`;
});

await step('projects-open', async () => {
  await page.goto('/projects');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.getByText('Smoke Project', { exact: true }).first().click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/projects-open.png`, fullPage: true });
  return `url=${page.url().replace('http://localhost:3000', '')}`;
});

await step('backlog-priority', async () => {
  await page.goto('/backlog');
  await page.waitForLoadState('networkidle').catch(() => {});
  const prio = page.getByRole('button', { name: /Priority:.*Click to change/i }).first();
  await prio.click();
  await page.waitForTimeout(300);
  await page.getByRole('menuitem', { name: /lowest/i }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/backlog-priority.png`, fullPage: true });
  return 'priority set to Lowest';
});

await step('backlog-add-then-delete', async () => {
  await page.goto('/backlog');
  await page.waitForLoadState('networkidle').catch(() => {});
  const addBtn = page.getByRole('button', { name: /Add issue to Sprint 1/i }).first();
  await addBtn.click();
  await page.waitForTimeout(400);
  await page.keyboard.type('Backlog QA issue');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  const created = await page.getByText('Backlog QA issue', { exact: false }).first().isVisible().catch(() => false);
  // delete it
  await page.getByRole('button', { name: 'Delete Backlog QA issue' }).click().catch(() => {});
  await page.waitForTimeout(2500);
  const gone = !(await page.getByText('Backlog QA issue', { exact: false }).first().isVisible().catch(() => false));
  await page.screenshot({ path: `${OUT}/backlog-add-delete.png`, fullPage: true });
  return `created=${created} gone=${gone}`;
});

await step('epics-create-and-drawer', async () => {
  await page.goto('/epics');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.getByRole('button', { name: /new epic/i }).click();
  await page.locator('#epic-title').fill('Smoke Epic');
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: /create epic|add epic|^create$/i }).click();
  await page.waitForTimeout(2500);
  const visible = await page.getByText('Smoke Epic', { exact: false }).first().isVisible().catch(() => false);
  await page.screenshot({ path: `${OUT}/epics-after-create.png`, fullPage: true });
  // open drawer
  await page.getByRole('button', { name: /open epic/i }).first().click().catch(() => {});
  await page.waitForTimeout(2000);
  const drawerOpen = await page.getByText('Smoke Epic', { exact: false }).first().isVisible().catch(() => false);
  await page.screenshot({ path: `${OUT}/epics-drawer.png`, fullPage: true });
  return `created=${visible} drawerOpen=${drawerOpen}`;
});

console.log('\nCONSOLE ERRORS:', errs.length ? JSON.stringify(errs, null, 2) : 'none');
await browser.close();
