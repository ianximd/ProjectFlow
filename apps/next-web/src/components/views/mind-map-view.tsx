'use client';

import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import { loadMindMapGraph } from '@/server/actions/views';
import type { LiveScopeProp } from '@/components/views/view-surface';
import type { ViewTaskPageResult } from '@/server/queries/views';
import type { CustomField, MindMapGraph, MindMapNode, SavedView } from '@projectflow/types';

import styles from './mind-map-view.module.css';

interface Props {
  /** Paged tasks for the active view (unused here — the graph is fetched fresh). */
  taskPage: ViewTaskPageResult | null;
  /** The active saved view — its id drives the mind-map graph fetch. */
  activeView: SavedView;
  /** The scope's custom fields (kept for prop parity with the other surfaces). */
  customFields: CustomField[];
  /** Live-subscription scope (created/updated/deleted), resolved SSR in the page. */
  live: LiveScopeProp;
}

/**
 * Mind Map view — a collapsible nested tree of the parent→child task subtree
 * under the view's scope node. The graph (nodes + parent→child edges + roots)
 * is fetched client-side on mount via the `loadMindMapGraph` server action,
 * then rendered as a recursive `<ul>` from `graph.rootIds`. Each node with
 * children gets an expand/collapse toggle backed by a `collapsed` id set.
 */
export function MindMapView({ activeView }: Props) {
  const t = useTranslations('MindMap');
  const [graph, setGraph] = useState<MindMapGraph | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Fetch the graph on mount / when the active view changes. Cancel-guarded so a
  // late resolve after a view switch (or unmount) doesn't write stale state.
  useEffect(() => {
    let cancelled = false;
    setGraph(null);
    setCollapsed(new Set());
    loadMindMapGraph(activeView.id)
      .then((g) => { if (!cancelled) setGraph(g); })
      .catch(() => { /* keep the loading state; the surface stays inert */ });
    return () => { cancelled = true; };
  }, [activeView.id]);

  // Children index from edges (parent id → child ids), preserving node order.
  const childrenOf = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!graph) return map;
    for (const e of graph.edges) {
      const arr = map.get(e.from) ?? [];
      arr.push(e.to);
      map.set(e.from, arr);
    }
    return map;
  }, [graph]);

  const byId = useMemo(
    () => new Map((graph?.nodes ?? []).map((n) => [n.id, n] as const)),
    [graph],
  );

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!graph) return <div className={styles.empty}>{t('loading')}</div>;
  if (graph.nodes.length === 0) return <div className={styles.empty}>{t('noNodes')}</div>;

  const renderNode = (id: string): React.ReactNode => {
    const node = byId.get(id) as MindMapNode | undefined;
    if (!node) return null;
    const kids = childrenOf.get(id) ?? [];
    const isCollapsed = collapsed.has(id);
    return (
      <li key={id} className={styles.node}>
        <div className={styles.nodeRow}>
          {kids.length > 0 ? (
            <button
              type="button"
              className={styles.toggle}
              onClick={() => toggle(id)}
              aria-expanded={!isCollapsed}
              aria-label={isCollapsed ? t('expand') : t('collapse')}
              data-testid="mindmap-toggle"
            >
              {isCollapsed ? '▸' : '▾'}
            </button>
          ) : (
            <span className={styles.leaf} aria-hidden>•</span>
          )}
          <span className={styles.title} data-testid="mindmap-node">{node.title || t('untitled')}</span>
          <span className={styles.status}>{node.status}</span>
        </div>
        {kids.length > 0 && !isCollapsed && (
          <ul className={styles.children}>{kids.map(renderNode)}</ul>
        )}
      </li>
    );
  };

  return (
    <div data-testid="view-body-mindmap" className={styles.root}>
      <ul className={styles.tree}>{graph.rootIds.map(renderNode)}</ul>
    </div>
  );
}
