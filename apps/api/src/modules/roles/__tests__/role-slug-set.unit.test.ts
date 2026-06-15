import { describe, it, expect } from 'vitest';
import { resolveRoleSlugSet, type RoleSlugs } from '../slug-set.js';

const roles: RoleSlugs[] = [
  { roleId: 'sys-member', slugs: ['task.read', 'task.create', 'task.update'] },
  { roleId: 'custom-qa',  slugs: ['task.read', 'task.transition', 'report.read'] },
  { roleId: 'custom-ops', slugs: ['automation.read'] },
];

describe('resolveRoleSlugSet', () => {
  it('unions the slugs of every held role, distinct', () => {
    const got = resolveRoleSlugSet(roles, ['sys-member', 'custom-qa']);
    expect([...got].sort()).toEqual(
      ['report.read', 'task.create', 'task.read', 'task.transition', 'task.update'].sort(),
    );
  });
  it('returns an empty set when the user holds no roles', () => {
    expect(resolveRoleSlugSet(roles, []).size).toBe(0);
  });
  it('ignores held role ids that have no definition', () => {
    expect([...resolveRoleSlugSet(roles, ['custom-ops', 'ghost'])]).toEqual(['automation.read']);
  });
  it('a custom role grants exactly its own slugs (no floor leakage)', () => {
    const got = resolveRoleSlugSet(roles, ['custom-ops']);
    expect([...got]).toEqual(['automation.read']);
    expect(got.has('task.read')).toBe(false);
  });
});
