'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { WorkloadEntry } from '@projectflow/types';

interface Props {
  data: WorkloadEntry[];
}

export function WorkloadChart({ data }: Props) {
  const chartData = data.map(w => ({
    name: w.assigneeName,
    open: w.openIssues,
    done: w.doneIssues,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 4, right: 24, left: 80, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: '#8892b0' }} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#8892b0' }} width={76} />
        <Tooltip
          contentStyle={{ background: '#1e2030', border: '1px solid #2d3250', borderRadius: 8 }}
          labelStyle={{ color: '#cdd6f4', fontWeight: 600 }}
          itemStyle={{ color: '#cdd6f4' }}
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: '#8892b0' }} />
        <Bar dataKey="open" name="Open"  fill="#6c63ff" stackId="a" radius={[0, 0, 0, 0]} />
        <Bar dataKey="done" name="Done"  fill="#a6e3a1" stackId="a" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
