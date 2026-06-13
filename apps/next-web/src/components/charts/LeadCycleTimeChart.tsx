'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useTranslations } from 'next-intl';
import type { LeadCycleTimeReport } from '@projectflow/types';

interface Props {
  data: LeadCycleTimeReport;
}

const toHours = (s: number | null) => (s === null ? 0 : Math.round((s / 3600) * 10) / 10);

export function LeadCycleTimeChart({ data }: Props) {
  const t = useTranslations('Charts');

  const chartData = data.tasks.map(task => ({
    issue: task.issueKey,
    lead:  toHours(task.leadTimeSeconds),
    cycle: toHours(task.cycleTimeSeconds),
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 16, left: 24, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis type="number" tick={{ fontSize: 11, fill: '#8892b0' }} />
        <YAxis type="category" dataKey="issue" tick={{ fontSize: 11, fill: '#8892b0' }} width={80} />
        <Tooltip
          contentStyle={{ background: '#1e2030', border: '1px solid #2d3250', borderRadius: 8 }}
          labelStyle={{ color: '#cdd6f4', fontWeight: 600 }}
          itemStyle={{ color: '#cdd6f4' }}
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: '#8892b0' }} />
        <Bar dataKey="lead"  name={t('leadTime')}  fill="#3b4261" radius={[0, 3, 3, 0]} />
        <Bar dataKey="cycle" name={t('cycleTime')} fill="#6c63ff" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
