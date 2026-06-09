import { describe, it, expect } from 'vitest';
import { runStatusKey, formatDurationMs } from '../runFormat';

describe('run-history formatting', () => {
  it('maps each run status to its i18n key', () => {
    expect(runStatusKey('success')).toBe('runStatusSuccess');
    expect(runStatusKey('loop_blocked')).toBe('runStatusLoopBlocked');
    expect(runStatusKey('partial')).toBe('runStatusPartial');
    expect(runStatusKey('failed')).toBe('runStatusFailed');
    expect(runStatusKey('skipped')).toBe('runStatusSkipped');
  });
  it('formats duration, guarding null', () => {
    expect(formatDurationMs(1234)).toBe('1234');
    expect(formatDurationMs(null)).toBe('—');
  });
});
