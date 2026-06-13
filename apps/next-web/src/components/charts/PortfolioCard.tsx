'use client';

import { useTranslations } from 'next-intl';
import type { PortfolioEntry } from '@projectflow/types';

interface Props {
  data: PortfolioEntry[];
}

export function PortfolioCard({ data }: Props) {
  const t = useTranslations('Cards');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {data.map(s => (
        <div key={s.scopeId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: '0 0 120px', fontSize: 13, color: '#cdd6f4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {s.scopeName}
          </span>
          <div style={{ flex: 1, height: 8, borderRadius: 4, background: '#1e2030', overflow: 'hidden' }}>
            <div style={{ width: `${s.progressPct}%`, height: '100%', background: s.onTrack ? '#a6e3a1' : '#f38ba8' }} />
          </div>
          <span style={{ flex: '0 0 40px', fontSize: 12, color: '#8892b0', textAlign: 'right' }}>{s.progressPct}%</span>
          <span style={{
            flex: '0 0 auto', fontSize: 11, padding: '2px 8px', borderRadius: 6,
            background: s.onTrack ? 'rgba(166,227,161,0.15)' : 'rgba(243,139,168,0.15)',
            color: s.onTrack ? '#a6e3a1' : '#f38ba8',
          }}>
            {s.onTrack ? t('onTrack') : t('behind')}
          </span>
        </div>
      ))}
    </div>
  );
}
