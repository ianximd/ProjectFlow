// Load sweep: visit every migrated route, record status/redirect/console
// errors/h1/body, screenshot each. Run: node e2e/_smoke/route-sweep.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = 'e2e/_smoke/sweep';
mkdirSync(OUT, { recursive: true });
const WS = 'DDFDF2B7-0BEB-46F4-B691-56D94BC244A5';
const PROJ = 'B27C1E9E-DAC1-41F1-8F82-109031C87007';
const BAD = '00000000-0000-4000-8000-000000000000';

const routes = [
  ['dashboard', '/dashboard'],
  ['projects', '/projects'],
  ['backlog', '/backlog'],
  ['epics', '/epics'],
  ['roadmap', '/roadmap'],
  ['versions', '/versions'],
  ['workflows', '/workflows'],
  ['automations', '/automations'],
  ['project-settings', '/project-settings'],
  ['workspaces', '/workspaces'],
  ['ws-settings', `/workspaces/${WS}/settings`],
  ['ws-members', `/workspaces/${WS}/members`],
  ['ws-settings-BADID', `/workspaces/${BAD}/settings`],
  ['proj-settings', `/projects/${PROJ}/settings`],
  ['proj-settings-BADID', `/projects/${BAD}/settings`],
  ['settings-profile', '/settings/profile'],
  ['connected-accounts', '/settings/connected-accounts'],
  ['admin', '/admin'],
  ['notifications', '/notifications'],
  ['user-guide', '/user-guide'],
  ['graphql-explorer', '/graphql-explorer'],
  ['board', '/board'],
];

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ storageState: 'e2e/_smoke/state.json', baseURL: 'http://localhost:3000', viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
let errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

const rows = [];
for (const [slug, path] of routes) {
  errs = [];
  let status = '?';
  try {
    const resp = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    status = resp ? resp.status() : 'no-resp';
  } catch (e) { status = 'goto-err:' + String(e.message).slice(0, 50); }
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  const url = page.url().replace('http://localhost:3000', '');
  const h1 = await page.locator('h1').first().innerText({ timeout: 1500 }).catch(() => '');
  const body = (await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 160);
  await page.screenshot({ path: `${OUT}/${slug}.png`, fullPage: true }).catch(() => {});
  rows.push({ slug, status, url, h1: h1.slice(0, 44), errs: [...errs], body });
}
await browser.close();

for (const r of rows) {
  console.log(`\n[${r.slug}] status=${r.status} url=${r.url} h1="${r.h1}" consoleErrs=${r.errs.length}`);
  if (r.errs.length) console.log('   ERR:', JSON.stringify(r.errs.slice(0, 3)));
  console.log('   body:', r.body);
}
