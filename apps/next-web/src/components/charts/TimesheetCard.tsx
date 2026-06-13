'use client';

import { useTranslations } from 'next-intl';

interface Props {
  data: { ownLoggedSeconds?: number; rollupLoggedSeconds: number; rollupEstimateSeconds?: number };
}

const fmtHrs = (s: number) => `${Math.round((s / 3600) * 10) / 10}h`;

export function TimesheetCard({ data }: Props) {
  const t = useTranslations('Cards');
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', height: '100%' }}>
      <div>
        <div style={{ fontSize: 11, color: '#8892b0' }}>{t('logged')}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#cdd6f4' }}>{fmtHrs(data.rollupLoggedSeconds)}</div>
      </div>
      {data.rollupEstimateSeconds !== undefined && (
        <div>
          <div style={{ fontSize: 11, color: '#8892b0' }}>{t('estimate')}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#cdd6f4' }}>{fmtHrs(data.rollupEstimateSeconds)}</div>
        </div>
      )}
    </div>
  );
}
