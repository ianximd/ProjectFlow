import { describe, expect, it } from 'vitest';
import { legacyTypeForTaskType } from '../tasktype.service.js';

describe('legacyTypeForTaskType', () => {
  it('maps a known enum name (case-insensitive) to that enum', () => {
    expect(legacyTypeForTaskType({ nameSingular: 'Bug', isMilestone: false })).toBe('BUG');
    expect(legacyTypeForTaskType({ nameSingular: 'epic', isMilestone: false })).toBe('EPIC');
  });
  it('maps the default / unknown custom type to TASK', () => {
    expect(legacyTypeForTaskType({ nameSingular: 'Initiative', isMilestone: false })).toBe('TASK');
  });
  it('maps a milestone type to TASK (board has no MILESTONE bucket)', () => {
    expect(legacyTypeForTaskType({ nameSingular: 'Milestone', isMilestone: true })).toBe('TASK');
  });
});
