// Final mutations: workflows create-workflow -> add-status; automations open
// rule dialog + attempt create. Run: node e2e/_smoke/mut5.mjs
import { chromium } from '@playwright/test';

const OUT = 'e2e/_smoke/mutate';
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ storageState: 'e2e/_smoke/state.json', baseURL: 'http://localhost:3000', viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
const step = async (name, fn) => {
  try { const r = await fn(); console.log(`[${name}] OK ${r ?? ''}`); }
  catch (e) { const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200); console.log(`[${name}] FAIL ${String(e.message).slice(0, 90)} | body=${body}`); }
};

await step('workflows-create-and-add-status', async () => {
  await page.goto('/workflows');
  await page.waitForLoadState('networkidle').catch(() => {});
  // If no workflow yet, create one from the default template.
  const createWf = page.getByRole('button', { name: /create workflow/i });
  if (await createWf.isVisible().catch(() => false)) {
    await createWf.click();
    await page.waitForTimeout(2500);
  }
  const created = await page.getByText(/statuses/i).first().isVisible().catch(() => false);
  // Now add a status.
  await page.getByRole('button', { name: /^add status$/i }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('#st-name').fill('Smoke Status');
  await dlg.locator('#st-cat').click().catch(() => {});
  await page.getByRole('option').first().click().catch(() => {});
  await dlg.getByRole('button', { name: /add status/i }).click();
  await page.waitForTimeout(2500);
  const ok = await page.getByText('Smoke Status', { exact: false }).first().isVisible().catch(() => false);
  await page.screenshot({ path: `${OUT}/workflows-create-status.png`, fullPage: true });
  return `workflowCreated=${created} statusAdded=${ok}`;
});

await step('automations-create-rule', async () => {
  await page.goto('/automations');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.getByRole('button', { name: /new rule/i }).first().click();
  await page.waitForTimeout(800);
  const dialogOpen = await page.locator('#rule-name').isVisible().catch(() => false);
  if (dialogOpen) await page.locator('#rule-name').fill('Smoke Rule');
  const createBtn = page.getByRole('button', { name: /^create rule$/i });
  const enabled = await createBtn.isEnabled().catch(() => false);
  if (enabled) { await createBtn.click(); await page.waitForTimeout(2500); }
  const ruleVisible = await page.getByText('Smoke Rule', { exact: false }).first().isVisible().catch(() => false);
  await page.screenshot({ path: `${OUT}/automations-rule.png`, fullPage: true });
  return `dialogOpen=${dialogOpen} createEnabled=${enabled} ruleVisible=${ruleVisible}`;
});

console.log('\nCONSOLE ERRORS:', errs.length ? JSON.stringify(errs, null, 2) : 'none');
await browser.close();
