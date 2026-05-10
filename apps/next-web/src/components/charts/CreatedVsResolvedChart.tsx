'use client';

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { CreatedVsResolvedEntry } from '@projectflow/types';

interface Props {
  data: CreatedVsResolvedEntry[];
}

export function CreatedVsResolvedChart({ data }: Props) {
  const chartData = data.map(d => ({
    week:     d.weekStart?.slice(5) ?? '',   // MM-DD
    created:  d.created,
    resolved: d.resolved,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gradCreated" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#f38ba8" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#f38ba8" stopOpacity={0.0} />
          </linearGradient>
          <linearGradient id="gradResolved" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#a6e3a1" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#a6e3a1" stopOpacity={0.0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#8892b0' }} />
        <YAxis tick={{ fontSize: 11, fill: '#8892b0' }} />
        <Tooltip
          contentStyle={{ background: '#1e2030', border: '1px solid #2d3250', borderRadius: 8 }}
          labelStyle={{ color: '#cdd6f4', fontWeight: 600 }}
          itemStyle={{ color: '#cdd6f4' }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: '#8892b0' }} />
        <Area
          type="monotone"
          dataKey="created"
          name="Created"
          stroke="#f38ba8"
          fill="url(#gradCreated)"
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="resolved"
          name="Resolved"
          stroke="#a6e3a1"
          fill="url(#gradResolved)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
