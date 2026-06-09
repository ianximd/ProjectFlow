'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { setDocWiki } from '@/server/actions/docs';
import { notifyActionError } from '@/lib/apiErrorToast';

export function WikiToggle({ docId, initialIsWiki }: { docId: string; initialIsWiki: boolean }) {
  const t = useTranslations('Docs');
  const [isWiki, setIsWiki] = useState(initialIsWiki);
  const [pending, start] = useTransition();

  const toggle = () =>
    start(async () => {
      const next = !isWiki;
      const r = await setDocWiki(docId, next);
      if (!r.ok) return notifyActionError(r as { error: string; code?: string; status?: number });
      setIsWiki(next);
    });

  return (
    <div>
      <button disabled={pending} onClick={toggle} aria-pressed={isWiki} data-wiki-toggle>
        {isWiki ? t('markedWiki') : t('markAsWiki')}
      </button>
      {isWiki && (
        <span data-wiki-badge title={t('verified')}>
          ✔ {t('wiki')}
        </span>
      )}
    </div>
  );
}
