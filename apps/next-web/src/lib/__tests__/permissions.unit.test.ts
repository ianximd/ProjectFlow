import { describe, it, expect } from 'vitest';
import { computeInheritedFrom, groupGrantsBySubject } from '../permissions';
import type { ObjectPermissionGrant } from '@projectflow/types';

const base: Omit<ObjectPermissionGrant, 'objectType' | 'objectId' | 'inherited' | 'inheritedFromName'> = {
  id: 'g1', subjectType: 'USER', subjectId: 'u1', subjectName: 'Ada', subjectEmail: 'ada@x.test', level: 'EDIT',
};

describe('computeInheritedFrom', () => {
  it('marks a grant on the same object as direct (not inherited)', () => {
    const g = { ...base, objectType: 'LIST' as const, objectId: 'L1', inherited: false, inheritedFromName: null };
    expect(computeInheritedFrom('LIST', 'L1', g)).toEqual({ inherited: false, fromName: null });
  });
  it('marks a grant on an ancestor as inherited with the ancestor name', () => {
    const g = { ...base, objectType: 'SPACE' as const, objectId: 'S1', inherited: true, inheritedFromName: 'Marketing' };
    expect(computeInheritedFrom('LIST', 'L1', g)).toEqual({ inherited: true, fromName: 'Marketing' });
  });
});

describe('groupGrantsBySubject', () => {
  it('keeps the most-specific (direct) grant when a subject has both inherited + direct', () => {
    const grants: ObjectPermissionGrant[] = [
      { ...base, objectType: 'SPACE', objectId: 'S1', level: 'VIEW', inherited: true, inheritedFromName: 'Marketing' },
      { ...base, objectType: 'LIST',  objectId: 'L1', level: 'EDIT', inherited: false, inheritedFromName: null },
    ];
    const rows = groupGrantsBySubject('LIST', 'L1', grants);
    expect(rows).toHaveLength(1);
    expect(rows[0].effectiveLevel).toBe('EDIT');  // direct beats inherited
    expect(rows[0].inheritedLevel).toBe('VIEW');  // still surfaced for the UI hint
  });
});
