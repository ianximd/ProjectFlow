import { defineConfig } from 'vitest/config';

// Two project flavours sharing one config:
//   - "unit"        — fast, no external services, runs on every PR.
//   - "integration" — hits the real SQL Server + Redis stack, opt-in via
//     `vitest --project integration`. Phase 2.A only ships unit; the
//     integration spine (Phase 2.B) populates this project's includes.
//
// Vitest 4 resolves NodeNext `.js`-suffixed relative imports out of the
// box (verified — no alias stripping needed).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name:        'unit',
          include:     ['src/**/*.unit.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name:        'integration',
          include:     ['src/**/*.integration.test.ts'],
          environment: 'node',
          // Integration tests share schema state in SQL Server, so they
          // run sequentially within a file and across files.
          fileParallelism: false,
          testTimeout:     30_000,
          hookTimeout:     60_000, // first-run SP deploy can take 30s+
          globalSetup:     ['./src/__tests__/setup/globalSetup.ts'],
          setupFiles:      ['./src/__tests__/setup/integration.setup.ts'],
        },
      },
    ],
  },
});
