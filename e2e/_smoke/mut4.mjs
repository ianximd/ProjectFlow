// Remaining mutations batch 4: workflows add-status, automations create-rule,
// components create+delete, members invite+role, ws-settings save, proj-settings
// save, roadmap drawer-open. Run: node e2e/_smoke/mut4.mjs
import { chromium } from '@playwright/test';

const OUT = 'e2e/_smoke/mutate';
const WS = 'DDFDF2B7-0BEB-46F4-B691-56D94BC244A5';
const PROJ = 'B27C1E9E-DAC1-41F1-8F82-109031C87007';
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ storageState: 'e2e/_smoke/state.json', baseURL: 'http://localhost:3000', viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(8000);
page.on('dialog', (d) => d.accept().catch(() => {}));
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
const step = async (name, fn) => {
  try { const r = await fn(); console.log(`[${name}] OK ${r ?? ''}`); }
  catch (e) {
    const url = page.url().replace('http://localhost:3000', '');
    const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 220);
    console.log(`[${name}] FAIL ${String(e.message).slice(0, 90)} | url=${url} | body=${body}`);
  }
};
const pickFirstOption = async () => { const o = page.getByRole('option'); await o.first().click(); };

await step('workflows-add-status', async () => {
  await page.goto('/workflows');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.getByRole('button', { name: /^add status$/i }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('#st-name').fill('Smoke Status');
  await dlg.locator('#st-cat').click().catch(() => {});
  await pickFirstOption().catch(() => {});
  await dlg.getByRole('button', { name: /add status/i }).click();
  await page.waitForTimeout(2500);
  const ok = await page.getByText('Smoke Status', { exact: false }).first().isVisible().catch(() => false);
  await page.screenshot({ path: `${OUT}/workflows-add-status.png`, fullPage: true });
  return `visible=${ok}`;
});

await step('automations-create-rule', async () => {
  await page.goto('/automations');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.getByRole('button', { name: /new rule|create your first rule/i }).first().click();
  await page.locator('#rule-name').fill('Smoke Rule');
  await page.getByRole('button', { name: /^create rule$/i }).click();
  await page.waitForTimeout(2500);
  const ok = await page.getByText('Smoke Rule', { exact: false }).first().isVisible().catch(() => false);
  await page.screenshot({ path: `${OUT}/automations-create-rule.png`, fullPage: true });
  return `visible=${ok}`;
});

await step('components-create-delete', async () => {
  await page.goto('/project-settings');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.getByRole('tab', { name: /components/i }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /new component|add component/i }).click();
  await page.locator('#cmp-name').fill('Smoke Component');
  await page.getByRole('button', { name: /create component/i }).click();
  await page.waitForTimeout(2000);
  const created = await page.getByText('Smoke Component', { exact: false }).first().isVisible().catch(() => false);
  await page.getByRole('button', { name: /^delete$/i }).first().click().catch(() => {});
  await page.waitForTimeout(2000);
  const gone = !(await page.getByText('Smoke Component', { exact: false }).first().isVisible().catch(() => false));
  await page.screenshot({ path: `${OUT}/components-create-delete.png`, fullPage: true });
  return `created=${created} gone=${gone}`;
});

await step('members-invite-and-role', async () => {
  await page.goto(`/workspaces/${WS}/members`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.getByRole('button', { name: /^invite$/i }).click();
  await page.locator('#inv-email').fill('smoke2@projectflow.test');
  await page.getByRole('button', { name: /send invite/i }).click();
  await page.waitForTimeout(2500);
  const invited = await page.getByText('smoke2@projectflow.test', { exact: false }).first().isVisible().catch(() => false);
  // change the new member's role
  const row = page.getByRole('row', { hasText: 'smoke2@projectflow.test' });
  await row.getByRole('combobox').click().catch(() => {});
  await page.waitForTimeout(300);
  await page.getByRole('option', { name: /admin/i }).first().click().catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/members-invite-role.png`, fullPage: true });
  return `invited=${invited}`;
});

await step('ws-settings-save', async () => {
  await page.goto(`/workspaces/${WS}/settings`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.locator('#ws-name').fill('Smoke WS Renamed');
  await page.getByRole('button', { name: /save/i }).first().click();
  await page.waitForTimeout(2500);
  await page.reload();
  await page.waitForLoadState('networkidle').catch(() => {});
  const val = await page.locator('#ws-name').inputValue().catch(() => '?');
  await page.screenshot({ path: `${OUT}/ws-settings-save.png`, fullPage: true });
  return `persisted=${JSON.stringify(val)}`;
});

await step('proj-settings-save', async () => {
  await page.goto(`/projects/${PROJ}/settings`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.locator('#p-name').fill('Smoke Project Renamed');
  await page.getByRole('button', { name: /save/i }).first().click();
  await page.waitForTimeout(2500);
  await page.reload();
  await page.waitForLoadState('networkidle').catch(() => {});
  const val = await page.locator('#p-name').inputValue().catch(() => '?');
  await page.screenshot({ path: `${OUT}/proj-settings-save.png`, fullPage: true });
  return `persisted=${JSON.stringify(val)}`;
});

await step('roadmap-drawer', async () => {
  await page.goto('/roadmap');
  await page.waitForLoadState('networkidle').catch(() => {});
  // click a task title/bar to open its drawer
  await page.getByText('Design login screen', { exact: false }).first().click({ timeout: 5000 });
  await page.waitForTimeout(2000);
  const drawer = await page.getByText(/schedule/i).first().isVisible().catch(() => false);
  await page.screenshot({ path: `${OUT}/roadmap-drawer.png`, fullPage: true });
  return `drawerLikelyOpen=${drawer}`;
});

console.log('\nCONSOLE ERRORS:', errs.length ? JSON.stringify(errs, null, 2) : 'none');
await browser.close();
