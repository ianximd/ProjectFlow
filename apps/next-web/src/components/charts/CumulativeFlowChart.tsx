'use client';

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { CumulativeFlowEntry } from '@projectflow/types';

interface Props {
  data: CumulativeFlowEntry[];
}

const COLORS = ['#6c63ff', '#89b4fa', '#a6e3a1', '#f9e2af', '#f38ba8', '#cba6f7'];

/** Pivot long (date,status,count) entries into a wide per-date series, every band filled. */
function pivot(entries: CumulativeFlowEntry[]): { statuses: string[]; rows: Array<Record<string, number | string>> } {
  const statuses: string[] = [];
  const byDate = new Map<string, Record<string, number | string>>();
  for (const e of entries) {
    if (!statuses.includes(e.status)) statuses.push(e.status);
    const key = e.date ?? '';
    let row = byDate.get(key);
    if (!row) { row = { date: key }; byDate.set(key, row); }
    row[e.status] = e.issueCount;
  }
  const rows = [...byDate.values()].map(r => {
    for (const s of statuses) if (r[s] === undefined) r[s] = 0;
    return r;
  });
  return { statuses, rows };
}

export function CumulativeFlowChart({ data }: Props) {
  const { statuses, rows } = pivot(data);

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8892b0' }} tickFormatter={d => String(d).slice(5)} />
        <YAxis tick={{ fontSize: 11, fill: '#8892b0' }} />
        <Tooltip
          contentStyle={{ background: '#1e2030', border: '1px solid #2d3250', borderRadius: 8 }}
          labelStyle={{ color: '#cdd6f4', fontWeight: 600 }}
          itemStyle={{ color: '#cdd6f4' }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: '#8892b0' }} />
        {statuses.map((s, i) => (
          <Area key={s} type="monotone" dataKey={s} name={s} stackId="1"
                stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.5} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
