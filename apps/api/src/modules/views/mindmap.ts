import type { MindMapGraph, MindMapNode, MindMapEdge } from '@projectflow/types';

/** Raw row from usp_Hierarchy_DescendantTasks (SELECT t.* → PascalCase). Only
 *  the four columns the graph needs are declared; extra columns are ignored. */
export interface DescendantRow {
  Id:           string;
  ParentTaskId: string | null;
  Title:        string;
  Status:       string;
}

/**
 * Build a parent→child node/edge graph from a flat descendant set.
 *
 * A node is a ROOT when its ParentTaskId is null OR points outside the returned
 * set (the scope began below that ancestor). Roots are re-rooted (parentId set
 * to null, depth 0). Depth is computed by BFS from the roots; the visited guard
 * makes the walk cycle-safe even if the data contains a self/back reference.
 * Pure — no DB, no clock — so it is fully unit-testable.
 */
export function buildMindMapGraph(rows: DescendantRow[]): MindMapGraph {
  const ids = new Set(rows.map((r) => r.Id));
  const childrenOf = new Map<string, string[]>();
  const rootIds: string[] = [];

  for (const r of rows) {
    const hasInScopeParent = r.ParentTaskId !== null && r.ParentTaskId !== r.Id && ids.has(r.ParentTaskId);
    if (hasInScopeParent) {
      const arr = childrenOf.get(r.ParentTaskId!) ?? [];
      arr.push(r.Id);
      childrenOf.set(r.ParentTaskId!, arr);
    } else {
      rootIds.push(r.Id);
    }
  }

  const meta = new Map(rows.map((r) => [r.Id, r] as const));
  const nodes: MindMapNode[] = [];
  const edges: MindMapEdge[] = [];
  const visited = new Set<string>();

  const queue: Array<{ id: string; parentId: string | null; depth: number }> =
    rootIds.map((id) => ({ id, parentId: null, depth: 0 }));
  while (queue.length) {
    const { id, parentId, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const r = meta.get(id)!;
    nodes.push({ id, title: r.Title, status: r.Status, parentId, depth });
    if (parentId !== null) edges.push({ from: parentId, to: id });
    for (const childId of childrenOf.get(id) ?? []) {
      if (!visited.has(childId)) queue.push({ id: childId, parentId: id, depth: depth + 1 });
    }
  }

  return { nodes, edges, rootIds };
}
