import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Vitest config for the Next.js app. Component tests run under jsdom; the
// `@/...` alias mirrors tsconfig so imports work the same way they do in
// the app code.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    include:     ['src/**/*.test.{ts,tsx}'],
    setupFiles:  ['./vitest.setup.ts'],
    globals:     false,
  },
});
