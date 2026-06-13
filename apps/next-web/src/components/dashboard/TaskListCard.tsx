'use client';
import type { CardData } from '@projectflow/types';

export function TaskListCard({ data }: { data: CardData }) {
  const rows = (data.data as any[]) ?? [];
  return (
    <ul className="flex flex-col divide-y divide-border/50 text-xs">
      {rows.map((t) => (
        <li key={t.Id ?? t.id} className="py-1.5 flex items-center justify-between gap-2">
          <span className="truncate">{t.Title ?? t.title}</span>
          <span className="shrink-0 text-muted-foreground">{t.Status ?? t.status}</span>
        </li>
      ))}
      {rows.length === 0 && <li className="py-2 text-muted-foreground">No tasks</li>}
    </ul>
  );
}
