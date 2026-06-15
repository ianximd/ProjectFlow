'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { createShareLink, revokeShareLink, listShareLinks } from '@/server/actions/share';
import { notifyActionError } from '@/lib/apiErrorToast';
import type { ShareLink, ShareObjectType } from '@projectflow/types';
import styles from './ShareModal.module.css';

/**
 * Per-object sharing modal (Phase 10c). Lists existing public links, creates a
 * new read-only link (optional expiry), copies the public URL, and revokes.
 * Self-contained overlay + dialog so callers just mount it conditionally.
 */
export function ShareModal({
  objectType, objectId, onClose,
}: { objectType: ShareObjectType; objectId: string; onClose: () => void }) {
  const t = useTranslations('Share');
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [expiry, setExpiry] = useState('');
  const [pending, start] = useTransition();

  const refetch = () =>
    listShareLinks(objectType, objectId).then((r) => { if (r.ok) setLinks(r.data); });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refetch(); }, [objectType, objectId]);

  // Close on Escape (mirrors the drawer's other dialogs).
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const onCreate = () => start(async () => {
    const r = await createShareLink(objectType, objectId, expiry ? new Date(expiry).toISOString() : null);
    if (!r.ok) { notifyActionError(r); return; }
    setExpiry('');
    await refetch();
  });

  const onRevoke = (id: string) => start(async () => {
    const r = await revokeShareLink(id);
    if (!r.ok) { notifyActionError(r); return; }
    await refetch();
  });

  const publicUrl = (token: string) =>
    `${typeof window !== 'undefined' ? window.location.origin : ''}/share/${token}`;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.root}
        role="dialog"
        aria-modal="true"
        aria-label={t('title')}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 className={styles.heading}>{t('title')}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t('close')}>×</button>
        </header>

        <p className={styles.hint}>{t('readOnlyHint')}</p>

        <div className={styles.createRow}>
          <label className={styles.expiryLabel}>
            {t('expiry')}
            <input type="datetime-local" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </label>
          <button type="button" className={styles.createBtn} onClick={onCreate} disabled={pending}>
            {t('createLink')}
          </button>
        </div>

        <ul className={styles.list}>
          {links.length === 0 && <li className={styles.empty}>{t('noLinks')}</li>}
          {links.map((l) => (
            <li key={l.id} className={styles.item}>
              <input
                className={styles.url}
                readOnly
                value={publicUrl(l.token)}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                className={styles.copyBtn}
                onClick={() => navigator.clipboard?.writeText(publicUrl(l.token))}
              >
                {t('copy')}
              </button>
              {l.expiresAt && (
                <span className={styles.expires}>
                  {t('expiresAt', { date: new Date(l.expiresAt).toLocaleString() })}
                </span>
              )}
              <button
                type="button"
                className={styles.revokeBtn}
                onClick={() => onRevoke(l.id)}
                disabled={pending}
              >
                {t('revoke')}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
