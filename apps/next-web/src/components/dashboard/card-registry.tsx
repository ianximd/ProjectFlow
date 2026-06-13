'use client';

import type { JSX } from 'react';
import type { CardData, CardType } from '@projectflow/types';
import { TaskListCard } from './TaskListCard';
import { CalculationCard } from './CalculationCard';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

export type CardRenderer = (props: { data: CardData }) => JSX.Element;

const PALETTE = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7'];

function SeriesBar({ data }: { data: CardData }) {
  const rows = (data.data as Array<{ key: string; label: string; value: number }>) ?? [];
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#8892b0' }} />
        <YAxis tick={{ fontSize: 11, fill: '#8892b0' }} />
        <Tooltip />
        <Bar dataKey="value" fill={PALETTE[0]} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function SeriesLine({ data }: { data: CardData }) {
  const rows = (data.data as Array<{ key: string; label: string; value: number }>) ?? [];
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#8892b0' }} />
        <YAxis tick={{ fontSize: 11, fill: '#8892b0' }} />
        <Tooltip />
        <Line type="monotone" dataKey="value" stroke={PALETTE[0]} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function SeriesPie({ data }: { data: CardData }) {
  const rows = (data.data as Array<{ key: string; label: string; value: number }>) ?? [];
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={rows} dataKey="value" nameKey="label" outerRadius={90}>
          {rows.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}

function TimeTrackedCard({ data }: { data: CardData }) {
  const rows = (data.data as Array<{ userId: string; userName: string; totalSeconds: number }>) ?? [];
  return (
    <ul className="text-xs flex flex-col gap-1">
      {rows.map((r) => (
        <li key={r.userId} className="flex justify-between">
          <span>{r.userName}</span>
          <span className="tabular-nums">{Math.round(r.totalSeconds / 3600)}h</span>
        </li>
      ))}
      {rows.length === 0 && <li className="text-muted-foreground">No time logged</li>}
    </ul>
  );
}

function GoalCard({ data }: { data: CardData }) {
  const d = data.data as { value: number | null; pending?: boolean; name?: string };
  if (d.pending || d.value == null) return <div className="text-xs text-muted-foreground">—</div>;
  return (
    <div className="flex flex-col gap-1">
      {d.name && <div className="text-xs text-muted-foreground truncate">{d.name}</div>}
      <div className="text-3xl font-semibold tabular-nums">{Math.round(d.value)}%</div>
    </div>
  );
}

function FallbackCard() {
  return <div className="text-xs text-muted-foreground">Unsupported card type</div>;
}

const REGISTRY: Record<string, CardRenderer> = {
  task_list:    TaskListCard,
  calculation:  CalculationCard,
  bar:          SeriesBar,
  line:         SeriesLine,
  pie:          SeriesPie,
  time_tracked: TimeTrackedCard,
  goal:         GoalCard,
};

export function resolveCardRenderer(type: CardType): CardRenderer {
  return REGISTRY[type] ?? FallbackCard;
}
