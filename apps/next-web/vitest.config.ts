import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Vitest config for the Next.js app. Component tests run under jsdom; the
// `@/...` alias mirrors tsconfig so imports work the same way they do in
// the app code.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // `server-only` is a Next.js guard package that throws at runtime when
      // imported in a browser/client context. It has no meaningful export —
      // alias it to an empty shim so vitest's transform can resolve it without
      // error. All actual server actions are mocked in tests anyway, so the
      // guard is never executed.
      'server-only': path.resolve(__dirname, 'src/__mocks__/server-only.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    include:     ['src/**/*.test.{ts,tsx}'],
    setupFiles:  ['./vitest.setup.ts'],
    globals:     false,
  },
});
