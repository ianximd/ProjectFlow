import type { AutomationRunStatus } from '@projectflow/types';

/** Status → i18n key (pure, unit-tested). */
export function runStatusKey(status: AutomationRunStatus): string {
  switch (status) {
    case 'success':      return 'runStatusSuccess';
    case 'partial':      return 'runStatusPartial';
    case 'failed':       return 'runStatusFailed';
    case 'skipped':      return 'runStatusSkipped';
    case 'loop_blocked': return 'runStatusLoopBlocked';
    default:             return 'runStatusSkipped';
  }
}

/** Duration in ms, em-dash when null (pure, unit-tested). */
export function formatDurationMs(ms: number | null): string {
  return ms == null ? '—' : String(ms);
}
