'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { listDocVersions, restoreDocVersion } from '@/server/actions/docs';
import { notifyActionError } from '@/lib/apiErrorToast';
import type { DocPageVersionMeta } from '@projectflow/types';

export function DocHistoryPanel({ docId, pageId }: { docId: string; pageId: string }) {
  const t = useTranslations('Docs');
  const [versions, setVersions] = useState<DocPageVersionMeta[]>([]);
  const [pending, start] = useTransition();

  const refetch = () =>
    start(async () => {
      const r = await listDocVersions(pageId);
      if (r.ok) setVersions((r.data as DocPageVersionMeta[]) ?? []);
    });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refetch(); }, [pageId]);

  const restore = (versionId: string) =>
    start(async () => {
      const r = await restoreDocVersion(docId, pageId, versionId);
      if (!r.ok) return notifyActionError(r as { error: string; code?: string; status?: number });
      refetch();
    });

  return (
    <aside aria-label={t('history')}>
      <h3>{t('history')}</h3>
      {versions.length === 0 && <p>{t('noHistory')}</p>}
      <ul>
        {versions.map((v) => (
          <li key={v.id} data-doc-version={v.id}>
            <span>{v.createdByName}</span>
            <button disabled={pending} onClick={() => restore(v.id)}>
              {t('restore')}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
