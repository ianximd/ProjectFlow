'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { requestAccess } from '@/server/actions/share';
import { notifyActionError } from '@/lib/apiErrorToast';
import type { ShareObjectType } from '@projectflow/types';

/**
 * Request-access affordance (Phase 10c). Shown to an authenticated non-member who
 * hits a private object — sends an AccessRequests row + notifies the object's
 * owners/admins. The parent decides when to mount it (on a 403 / not-found).
 */
export function RequestAccessPanel({
  objectType, objectId,
}: { objectType: ShareObjectType; objectId: string }) {
  const t = useTranslations('AccessRequest');
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();

  const onSend = () => start(async () => {
    const r = await requestAccess(objectType, objectId, note.trim() || undefined);
    if (!r.ok) { notifyActionError(r); return; }
    setSent(true);
  });

  if (sent) return <div role="status">{t('sent')}</div>;

  return (
    <div role="region" aria-label={t('title')} style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 480 }}>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t('title')}</h2>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--muted-foreground, #6b7280)' }}>{t('description')}</p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('notePlaceholder')}
        maxLength={500}
        rows={3}
        style={{ resize: 'vertical', padding: '8px 10px', borderRadius: 6, border: '1px solid #4a5568', background: '#2d3748', color: '#e2e8f0', fontFamily: 'inherit', colorScheme: 'dark' }}
      />
      <button
        type="button"
        onClick={onSend}
        disabled={pending}
        style={{ alignSelf: 'flex-start', background: '#3182ce', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: pending ? 'progress' : 'pointer' }}
      >
        {pending ? t('sending') : t('requestAccess')}
      </button>
    </div>
  );
}
