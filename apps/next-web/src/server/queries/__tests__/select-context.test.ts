import { describe, it, expect } from 'vitest';
import { resolveActiveId } from '../select-context';

describe('resolveActiveId', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('uses the cookie id when it is in the list', () => { expect(resolveActiveId(list, 'b')).toBe('b'); });
  it('falls back to the first item when the cookie id is missing', () => { expect(resolveActiveId(list, 'zzz')).toBe('a'); });
  it('falls back to the first item when the cookie id is null', () => { expect(resolveActiveId(list, null)).toBe('a'); });
  it('returns null for an empty list', () => { expect(resolveActiveId([], 'a')).toBeNull(); });
});
