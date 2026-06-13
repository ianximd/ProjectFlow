'use client';
import type { CardData } from '@projectflow/types';

export function CalculationCard({ data }: { data: CardData }) {
  const value = (data.data as { value: number | null }).value;
  return <div className="text-4xl font-semibold tabular-nums">{value ?? '—'}</div>;
}
