import { defineConfig, devices } from '@playwright/test';

/**
 * Phase 2.C — single-flow E2E skeleton.
 *
 * Local: assumes the dev stack (SQL Server + Redis + MinIO) is up. Auto-
 * starts both apps (api on :3001, next-web on :3000) via the `webServer`
 * config below; if they're already running, reuses them.
 *
 * CI: a nightly job spins up the services itself, runs migrations + SP
 * deploys, then `npm run test:e2e` against this same config.
 *
 * Tests create unique-named users / workspaces (timestamp-suffixed) so
 * concurrent runs don't collide. Cleanup happens at end of each spec via
 * the soft-delete API. We deliberately don't pin the DB to a separate
 * "_E2E" database — keeping the same target as `npm run dev` makes it
 * easy for a developer to iterate on the test against their own data.
 */

export default defineConfig({
  testDir:       './e2e',
  testMatch:     '**/*.spec.ts',
  globalSetup:   './e2e/global-setup.ts',
  timeout:       60_000,
  expect:        { timeout: 10_000 },
  fullyParallel: false, // serial keeps DB-state contention obvious
  forbidOnly:    !!process.env.CI,
  retries:       process.env.CI ? 1 : 0,
  workers:       1,
  reporter:      process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL:           'http://localhost:3000',
    trace:             'retain-on-failure',
    screenshot:        'only-on-failure',
    actionTimeout:     10_000,
    navigationTimeout: 15_000,
  },

  projects: [
    {
      name: 'chromium',
      use:  { ...devices['Desktop Chrome'] },
    },
  ],

  // Two parallel webservers — Playwright waits for BOTH ports to be
  // healthy before starting the test run. `reuseExistingServer` lets a
  // developer who already has `npm run dev` going skip the cold boot.
  webServer: [
    {
      command:            'npm run dev --workspace apps/api',
      cwd:                '.',
      url:                'http://localhost:3001/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout:            120_000,
      stdout:             'pipe',
      stderr:             'pipe',
    },
    {
      command:            'npm run dev --workspace apps/next-web',
      cwd:                '.',
      url:                'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout:            120_000,
      stdout:             'pipe',
      stderr:             'pipe',
    },
  ],
});
