'use client';

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { BurndownReport } from '@projectflow/types';

interface Props {
  data: BurndownReport;
}

export function BurndownChart({ data }: Props) {
  const chartData = data.points.map(p => ({
    date:      p.date ?? '',
    remaining: p.remainingPoints,
    ideal:     p.idealPoints,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: '#8892b0' }}
          tickFormatter={d => d.slice(5)} /* MM-DD */
        />
        <YAxis tick={{ fontSize: 11, fill: '#8892b0' }} />
        <Tooltip
          contentStyle={{ background: '#1e2030', border: '1px solid #2d3250', borderRadius: 8 }}
          labelStyle={{ color: '#cdd6f4', fontWeight: 600 }}
          itemStyle={{ color: '#cdd6f4' }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: '#8892b0' }} />
        <Line
          type="monotone"
          dataKey="remaining"
          name="Remaining"
          stroke="#6c63ff"
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="ideal"
          name="Ideal"
          stroke="#f38ba8"
          strokeWidth={1.5}
          strokeDasharray="5 4"
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
