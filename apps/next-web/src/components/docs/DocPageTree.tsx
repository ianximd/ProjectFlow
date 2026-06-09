'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { buildPageTree } from '@/lib/docs/tree';
import { createDocPage, renameDocPage, moveDocPage } from '@/server/actions/docs';
import { notifyActionError } from '@/lib/apiErrorToast';
import type { DocPage, DocPageNode } from '@projectflow/types';

interface Props {
  docId: string;
  pages: DocPage[];
  activePageId: string | null;
  onSelect: (id: string) => void;
  onChanged: () => void;
}

export function DocPageTree({ docId, pages, activePageId, onSelect, onChanged }: Props) {
  const t = useTranslations('Docs');
  const [pending, start] = useTransition();
  const tree = buildPageTree(pages);

  const addChild = (parentPageId: string | null) =>
    start(async () => {
      const r = await createDocPage({ docId, parentPageId, title: t('untitled') });
      if (!r.ok) return notifyActionError(r as { error: string; code?: string; status?: number });
      onChanged();
    });

  const rename = (id: string, current: string) =>
    start(async () => {
      const next =
        typeof window !== 'undefined' ? window.prompt(t('renamePrompt'), current) : null;
      if (next == null || next.trim() === '') return;
      const r = await renameDocPage(id, next.trim());
      if (!r.ok) return notifyActionError(r as { error: string; code?: string; status?: number });
      onChanged();
    });

  const onDrop = (dragId: string, targetParentId: string | null, afterId: string | null) =>
    start(async () => {
      const r = await moveDocPage(dragId, targetParentId, afterId);
      if (!r.ok) return notifyActionError(r as { error: string; code?: string; status?: number });
      onChanged();
    });

  const renderNode = (n: DocPageNode, depth: number) => (
    <div key={n.id}>
      <div
        style={{ paddingLeft: depth * 14 }}
        data-doc-page-node={n.id}
        aria-current={n.id === activePageId ? 'page' : undefined}
        draggable
        onDragStart={(e) => e.dataTransfer.setData('text/page', n.id)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const id = e.dataTransfer.getData('text/page');
          if (id && id !== n.id) onDrop(id, n.id, null);
        }}
      >
        <button onClick={() => onSelect(n.id)}>
          {n.icon ?? '📄'} {n.title}
        </button>
        <button aria-label={t('rename')} onClick={() => rename(n.id, n.title)}>
          ✎
        </button>
        <button aria-label={t('addChild')} onClick={() => addChild(n.id)}>
          ＋
        </button>
      </div>
      {n.children.map((c) => renderNode(c, depth + 1))}
    </div>
  );

  return (
    <nav aria-label={t('pageTree')}>
      <button disabled={pending} onClick={() => addChild(null)}>
        ＋ {t('newPage')}
      </button>
      {tree.map((n) => renderNode(n, 0))}
    </nav>
  );
}
