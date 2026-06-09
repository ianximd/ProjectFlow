import type { DocPage, DocPageNode } from '@projectflow/types';

/** Build the nested page tree from a flat page list, ordered by position.
 *  Pages whose parent is absent are promoted to roots (orphan safety). */
export function buildPageTree(pages: DocPage[]): DocPageNode[] {
  const byId = new Map<string, DocPageNode>();
  for (const p of pages) {
    byId.set(p.id, {
      id:           p.id,
      docId:        p.docId,
      parentPageId: p.parentPageId,
      title:        p.title,
      icon:         p.icon,
      position:     p.position,
      children:     [],
    });
  }
  const roots: DocPageNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentPageId ? byId.get(node.parentPageId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (ns: DocPageNode[]): void => {
    ns.sort((a, b) => a.position - b.position);
    ns.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}
