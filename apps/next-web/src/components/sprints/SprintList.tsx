'use client';

import { useTranslations } from 'next-intl';
import type { Sprint, SprintPointsRollup } from '@projectflow/types';

interface Props {
  sprints: Array<Sprint & { rollup?: SprintPointsRollup }>;
}

export function SprintList({ sprints }: Props) {
  const t = useTranslations('Sprints');
  if (sprints.length === 0) return <p>{t('noSprints')}</p>;

  const statusLabel = (status: Sprint['status']) =>
    status === 'ACTIVE' ? t('statusActive')
    : status === 'COMPLETED' ? t('statusCompleted')
    : t('statusPlanned');

  return (
    <ul style={{ display: 'flex', flexDirection: 'column', gap: 10, listStyle: 'none', padding: 0 }}>
      {sprints.map((s) => (
        <li key={s.id} style={{ border: '1px solid var(--color-border,#2d3250)', borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>{s.name}</strong>
            <span>{statusLabel(s.status)}</span>
          </div>
          <div style={{ fontSize: 12, color: '#8892b0' }}>
            {t('startDate')}: {s.startDate ?? '—'} · {t('endDate')}: {s.endDate ?? '—'}
          </div>
          <div style={{ fontSize: 13 }}>
            {t('points')}: {s.rollup?.total.totalPoints ?? 0}
          </div>
          {s.rollup?.perAssignee?.length ? (
            <div style={{ fontSize: 12, marginTop: 4 }}>
              <div style={{ color: '#8892b0' }}>{t('pointsByAssignee')}</div>
              {s.rollup.perAssignee.map((a) => (
                <div key={a.userId}>{a.userName ?? a.userId}: {a.points}</div>
              ))}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
