'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { VelocityEntry } from '@projectflow/types';

interface Props {
  data: VelocityEntry[];
}

export function VelocityChart({ data }: Props) {
  const chartData = data.map(v => ({
    sprint:    v.sprintName,
    committed: v.committedPoints,
    completed: v.completedPoints,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="sprint" tick={{ fontSize: 11, fill: '#8892b0' }} />
        <YAxis tick={{ fontSize: 11, fill: '#8892b0' }} />
        <Tooltip
          contentStyle={{ background: '#1e2030', border: '1px solid #2d3250', borderRadius: 8 }}
          labelStyle={{ color: '#cdd6f4', fontWeight: 600 }}
          itemStyle={{ color: '#cdd6f4' }}
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: '#8892b0' }} />
        <Bar dataKey="committed" name="Committed" fill="#3b4261" radius={[3, 3, 0, 0]} />
        <Bar dataKey="completed" name="Completed"  fill="#6c63ff" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
