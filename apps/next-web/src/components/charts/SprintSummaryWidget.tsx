'use client';

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useTranslations } from 'next-intl';
import type { SprintSummaryReport } from '@projectflow/types';

interface Props {
  data: SprintSummaryReport;
}

const COLORS = ['#6c63ff', '#89b4fa', '#a6e3a1', '#f9e2af', '#f38ba8', '#cba6f7'];

export function SprintSummaryWidget({ data }: Props) {
  const t = useTranslations('Charts');

  const pieData = data.statusBreakdown.map(s => ({
    name:  s.status,
    value: s.issueCount,
  }));

  const pct = data.totalIssues > 0
    ? Math.round((data.completedIssues / data.totalIssues) * 100)
    : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* stat row */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {[
          { label: t('totalIssues'),     value: data.totalIssues },
          { label: t('completed'),       value: data.completedIssues },
          { label: t('incomplete'),      value: data.incompleteIssues },
          { label: t('totalPoints'),     value: data.totalPoints },
          { label: t('completedPoints'), value: data.completedPoints },
          { label: t('completionPct'),   value: `${pct}%` },
        ].map(s => (
          <div key={s.label} style={{
            background: 'var(--color-surface,#12131a)',
            borderRadius: 8,
            padding: '8px 14px',
            minWidth: 90,
          }}>
            <div style={{ fontSize: 11, color: '#8892b0', marginBottom: 2 }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#cdd6f4' }}>{s.value}</div>
          </div>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
            label={({ name, percent }) => `${name} (${Math.round((percent ?? 0) * 100)}%)`}
            labelLine={false}
          >
            {pieData.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ background: '#1e2030', border: '1px solid #2d3250', borderRadius: 8 }}
            itemStyle={{ color: '#cdd6f4' }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: '#8892b0' }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
