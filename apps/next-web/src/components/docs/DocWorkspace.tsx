'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DocPageTree } from './DocPageTree';
import { DocEditor } from './DocEditor';
import { DocHistoryPanel } from './DocHistoryPanel';
import { WikiToggle } from './WikiToggle';
import type { Doc, DocPage } from '@projectflow/types';

interface Props {
  doc: Doc;
  pages: DocPage[];
  me: { name: string };
}

export function DocWorkspace({ doc, pages, me }: Props) {
  const router = useRouter();
  const [activePageId, setActivePageId] = useState<string | null>(
    pages.length > 0 ? pages[0].id : null,
  );

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <DocPageTree
        docId={doc.id}
        pages={pages}
        activePageId={activePageId}
        onSelect={setActivePageId}
        onChanged={() => router.refresh()}
      />
      <div style={{ flex: 1, overflow: 'auto' }}>
        {activePageId && <DocEditor pageId={activePageId} me={me} />}
      </div>
      {activePageId && (
        <DocHistoryPanel docId={doc.id} pageId={activePageId} />
      )}
      <WikiToggle docId={doc.id} initialIsWiki={doc.isWiki} />
    </div>
  );
}
