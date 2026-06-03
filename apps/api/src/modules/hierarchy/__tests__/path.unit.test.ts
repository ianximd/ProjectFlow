import { describe, expect, it } from 'vitest';
import { spacePath, folderPath, listPath, descendantPrefix, rewritePrefix } from '../path.js';

describe('hierarchy path helpers', () => {
  const sid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const fid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const lid = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  it('spacePath wraps the space id with slashes', () => {
    expect(spacePath(sid)).toBe(`/${sid}/`);
  });
  it('folderPath appends folder id to the parent path', () => {
    expect(folderPath(`/${sid}/`, fid)).toBe(`/${sid}/${fid}/`);
  });
  it('listPath under a folder appends list id to folder path', () => {
    expect(listPath(`/${sid}/${fid}/`, lid)).toBe(`/${sid}/${fid}/${lid}/`);
  });
  it('listPath directly under a space (folderless)', () => {
    expect(listPath(`/${sid}/`, lid)).toBe(`/${sid}/${lid}/`);
  });
  it('descendantPrefix is the node path used for LIKE matching', () => {
    expect(descendantPrefix(`/${sid}/${fid}/`)).toBe(`/${sid}/${fid}/`);
  });
  it('rewritePrefix swaps an old ancestor prefix for a new one', () => {
    expect(rewritePrefix(`/${sid}/${fid}/${lid}/`, `/${sid}/${fid}/`, `/${sid}/`)).toBe(`/${sid}/${lid}/`);
  });
});
