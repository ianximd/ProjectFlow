import { describe, it, expect } from 'vitest';
import { buildMindMapGraph, type DescendantRow } from '../mindmap.js';

const row = (Id: string, ParentTaskId: string | null, Title = Id, Status = 'OPEN'): DescendantRow =>
  ({ Id, ParentTaskId, Title, Status });

describe('buildMindMapGraph', () => {
  it('builds a single-root tree with depth and parent→child edges', () => {
    const rows = [ row('a', null), row('b', 'a'), row('c', 'a'), row('d', 'b') ];
    const g = buildMindMapGraph(rows);
    expect(g.rootIds).toEqual(['a']);
    expect(g.nodes.find((n) => n.id === 'a')!.depth).toBe(0);
    expect(g.nodes.find((n) => n.id === 'b')!.depth).toBe(1);
    expect(g.nodes.find((n) => n.id === 'd')!.depth).toBe(2);
    expect(g.edges).toContainEqual({ from: 'a', to: 'b' });
    expect(g.edges).toContainEqual({ from: 'a', to: 'c' });
    expect(g.edges).toContainEqual({ from: 'b', to: 'd' });
  });
  it('treats a child whose parent is OUTSIDE the subtree as a root (depth 0)', () => {
    const rows = [row('b', 'x'), row('d', 'b')];
    const g = buildMindMapGraph(rows);
    expect(g.rootIds).toEqual(['b']);
    expect(g.nodes.find((n) => n.id === 'b')!.depth).toBe(0);
    expect(g.nodes.find((n) => n.id === 'b')!.parentId).toBeNull();
    expect(g.nodes.find((n) => n.id === 'd')!.depth).toBe(1);
    expect(g.edges).toEqual([{ from: 'b', to: 'd' }]);
  });
  it('supports multiple roots and is cycle-safe (a self/back-reference does not loop)', () => {
    const rows = [row('a', null), row('b', null), row('c', 'a'), row('a2', 'a2')];
    const g = buildMindMapGraph(rows);
    expect(g.rootIds.sort()).toEqual(['a', 'a2', 'b']);
    expect(g.nodes).toHaveLength(4);
    expect(g.nodes.every((n) => n.depth >= 0)).toBe(true);
  });
  it('returns an empty graph for no rows', () => {
    expect(buildMindMapGraph([])).toEqual({ nodes: [], edges: [], rootIds: [] });
  });
});
