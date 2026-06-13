'use client';

import { useEffect, useState } from 'react';
import { loadCardData } from '@/server/actions/dashboards';
import { resolveCardRenderer } from '@/components/dashboard/card-registry';
import type { CardData, Dashboard, DashboardCard } from '@projectflow/types';

export function DashboardPrint({ dashboard }: { dashboard: Dashboard }) {
  const cards = dashboard.cards ?? [];
  const [ready, setReady] = useState(0);

  // Trigger the browser print dialog once every card has rendered its data.
  useEffect(() => {
    if (cards.length > 0 && ready >= cards.length) {
      const h = setTimeout(() => window.print(), 300);
      return () => clearTimeout(h);
    }
  }, [ready, cards.length]);

  return (
    <div style={{ padding: 24, background: '#fff', color: '#111' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>{dashboard.name}</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        {cards.map((card) => (
          <PrintCard key={card.id} card={card} onReady={() => setReady((n) => n + 1)} />
        ))}
      </div>
    </div>
  );
}

function PrintCard({ card, onReady }: { card: DashboardCard; onReady: () => void }) {
  const [data, setData] = useState<CardData | null>(null);
  useEffect(() => {
    loadCardData(card.id).then((r) => { if (r.ok) setData(r.data); onReady(); });
  }, [card.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const Renderer = resolveCardRenderer(card.type);
  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, breakInside: 'avoid' }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{card.title ?? card.type}</div>
      {data ? <Renderer data={data} /> : <div>…</div>}
    </div>
  );
}
