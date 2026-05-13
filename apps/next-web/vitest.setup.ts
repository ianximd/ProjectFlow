import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Vitest 4 + RTL 16 do NOT auto-mount RTL's afterEach. Without this,
// rendered components from earlier tests bleed into later tests' DOM and
// `getByLabelText` finds duplicates.
afterEach(() => {
  cleanup();
});
