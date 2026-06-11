import { describe, it, expect, vi } from 'vitest';

// `formatElapsed` is a pure export, but importing the component pulls in the
// `'use server'` worklogs actions module, whose `../session` does
// `import 'server-only'` — a module vitest's transform can't resolve. Stub the
// actions module so only the pure code is loaded; we never call the actions here.
vi.mock('@/server/actions/worklogs', () => ({
  getActiveTimer: vi.fn(),
  startTimer:     vi.fn(),
  stopTimer:      vi.fn(),
  setEstimate:    vi.fn(),
  getRollup:      vi.fn(),
}));

import { formatElapsed } from '../GlobalTimerWidget';

describe('formatElapsed', () => {
  it('formats h:mm:ss', () => { expect(formatElapsed(3661)).toBe('1:01:01'); });
  it('formats m:ss under an hour', () => { expect(formatElapsed(125)).toBe('2:05'); });
  it('shows 0:00 at zero', () => { expect(formatElapsed(0)).toBe('0:00'); });
});
