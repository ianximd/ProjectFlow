import { describe, it, expect } from 'vitest';
import { buildPageTree } from '@/lib/docs/tree';
import type { DocPage } from '@projectflow/types';

const p = (id: string, parentPageId: string | null, position: number, title = id): DocPage => ({
  id, docId: 'd', parentPageId, title, icon: null, cover: null, position, bodyJson: null, createdAt: '', updatedAt: '',
});

describe('buildPageTree', () => {
  it('nests children under parents, ordered by position', () => {
    const flat = [p('a', null, 1), p('b', null, 0), p('a1', 'a', 1), p('a0', 'a', 0)];
    const tree = buildPageTree(flat);
    expect(tree.map((n) => n.id)).toEqual(['b', 'a']);       // position order at root
    const a = tree.find((n) => n.id === 'a')!;
    expect(a.children.map((n) => n.id)).toEqual(['a0', 'a1']); // children ordered by position
  });

  it('treats pages whose parent is missing as roots (orphan safety)', () => {
    const tree = buildPageTree([p('x', 'gone', 0)]);
    expect(tree.map((n) => n.id)).toEqual(['x']);
  });
});
