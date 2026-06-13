'use client';

import { useTranslations } from 'next-intl';

interface Props {
  data: { value: number; target: number };
}

export function BatteryCard({ data }: Props) {
  const t = useTranslations('Cards');
  const pct = data.target > 0 ? Math.min(100, Math.round((data.value / data.target) * 100)) : 0;
  const color = pct >= 100 ? '#a6e3a1' : pct >= 50 ? '#f9e2af' : '#f38ba8';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div style={{ position: 'relative', width: 120, height: 56, border: '3px solid #3b4261', borderRadius: 8, padding: 4 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width .3s' }} />
        <div style={{ position: 'absolute', right: -8, top: 18, width: 5, height: 20, background: '#3b4261', borderRadius: 2 }} />
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#cdd6f4' }}>{pct}%</div>
      <div style={{ fontSize: 11, color: '#8892b0' }}>{t('ofTarget', { value: data.value, target: data.target })}</div>
    </div>
  );
}
