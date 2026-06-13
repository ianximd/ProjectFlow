'use client';

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useTranslations } from 'next-intl';
import type { BurnupReport } from '@projectflow/types';

interface Props {
  data: BurnupReport;
}

export function BurnupChart({ data }: Props) {
  const t = useTranslations('Charts');

  const chartData = data.points.map(p => ({
    date:      p.date ?? '',
    completed: p.completedPoints,
    scope:     p.scopePoints,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8892b0' }} tickFormatter={d => d.slice(5)} />
        <YAxis tick={{ fontSize: 11, fill: '#8892b0' }} />
        <Tooltip
          contentStyle={{ background: '#1e2030', border: '1px solid #2d3250', borderRadius: 8 }}
          labelStyle={{ color: '#cdd6f4', fontWeight: 600 }}
          itemStyle={{ color: '#cdd6f4' }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: '#8892b0' }} />
        <Line type="monotone" dataKey="scope"     name={t('scope')}     stroke="#3b4261" strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
        <Line type="monotone" dataKey="completed" name={t('completed')} stroke="#6c63ff" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
