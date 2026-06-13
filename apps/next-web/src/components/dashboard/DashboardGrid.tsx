'use client';

import { useEffect, useState, useTransition, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, rectSortingStrategy, arrayMove, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, Settings, Trash2, Printer } from 'lucide-react';
import { addCard, deleteCard, reorderCards, loadCardData } from '@/server/actions/dashboards';
import { notifyActionError } from '@/lib/apiErrorToast';
import { resolveCardRenderer } from './card-registry';
import { CardConfigDrawer } from './CardConfigDrawer';
import type { CardData, CardType, Dashboard, DashboardCard } from '@projectflow/types';
import styles from './DashboardGrid.module.css';

const ADDABLE: CardType[] = ['task_list', 'calculation', 'bar', 'line', 'pie', 'time_tracked', 'goal'];

export function DashboardGrid({ dashboard }: { dashboard: Dashboard }) {
  const t = useTranslations('DashboardCards');
  const router = useRouter();
  const [cards, setCards] = useState<DashboardCard[]>(dashboard.cards ?? []);
  const [configuring, setConfiguring] = useState<DashboardCard | null>(null);
  const [, start] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const persist = useCallback((next: DashboardCard[]) => {
    start(async () => {
      const r = await reorderCards(dashboard.id, next.map((c, i) => ({ id: c.id, layout: c.layout, position: i })));
      if (!r.ok) notifyActionError(r);
    });
  }, [dashboard.id]);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setCards((cs) => {
      const oldI = cs.findIndex((c) => c.id === active.id);
      const newI = cs.findIndex((c) => c.id === over.id);
      const next = arrayMove(cs, oldI, newI);
      persist(next);
      return next;
    });
  };

  const onAdd = (type: CardType) => start(async () => {
    const r = await addCard(dashboard.id, {
      type, title: t(`type_${type}`),
      config: type === 'calculation' ? { aggregate: { op: 'count' } } : { filter: { conjunction: 'AND', rules: [] } },
      layout: { x: 0, y: 0, w: 6, h: 4 },
    });
    if (!r.ok) return notifyActionError(r);
    setCards((cs) => [...cs, r.data]);
  });

  const onResize = (id: string, w: number, h: number) =>
    setCards((cs) => {
      const next = cs.map((c) => (c.id === id ? { ...c, layout: { ...c.layout, w, h } } : c));
      persist(next);
      return next;
    });

  const onDelete = (id: string) => start(async () => {
    const r = await deleteCard(id);
    if (!r.ok) return notifyActionError(r);
    setCards((cs) => cs.filter((c) => c.id !== id));
  });

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.addMenu}>
          <span className={styles.addLabel}><Plus className="size-3.5" /> {t('addCard')}</span>
          {ADDABLE.map((type) => (
            <button key={type} className={styles.addBtn} onClick={() => onAdd(type)} data-add-type={type}>
              {t(`type_${type}`)}
            </button>
          ))}
        </div>
        <button
          className={styles.printBtn}
          onClick={() => router.push(`/dashboard?id=${dashboard.id}&print=1`)}
          data-testid="export-pdf"
        >
          <Printer className="size-3.5" /> {t('exportPdf')}
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={cards.map((c) => c.id)} strategy={rectSortingStrategy}>
          <div className={styles.grid}>
            {cards.map((card) => (
              <SortableCard
                key={card.id}
                card={card}
                onConfigure={() => setConfiguring(card)}
                onDelete={() => onDelete(card.id)}
                onResize={(w, h) => onResize(card.id, w, h)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {configuring && (
        <div className={styles.drawer}>
          <CardConfigDrawer card={configuring} onClose={() => setConfiguring(null)} onSaved={() => router.refresh()} />
        </div>
      )}
    </div>
  );
}

function SortableCard({
  card, onConfigure, onDelete, onResize,
}: { card: DashboardCard; onConfigure: () => void; onDelete: () => void; onResize: (w: number, h: number) => void }) {
  const t = useTranslations('DashboardCards');
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: card.id });
  const [data, setData] = useState<CardData | null>(null);

  useEffect(() => {
    let active = true;
    loadCardData(card.id).then((r) => { if (active && r.ok) setData(r.data); });
    return () => { active = false; };
  }, [card.id]);

  const Renderer = resolveCardRenderer(card.type);
  const style = {
    transform: CSS.Transform.toString(transform), transition,
    gridColumn: `span ${card.layout.w}`, gridRow: `span ${card.layout.h}`,
  };

  return (
    <div ref={setNodeRef} style={style} className={styles.card} data-card-type={card.type}>
      <div className={styles.cardHeader}>
        <span className={styles.dragHandle} {...attributes} {...listeners} aria-label={t('drag')}>⠿</span>
        <span className={styles.cardTitle}>{card.title ?? t(`type_${card.type}`)}</span>
        <button onClick={onConfigure} aria-label={t('configure')}><Settings className="size-3.5" /></button>
        <button onClick={onDelete} aria-label={t('remove')}><Trash2 className="size-3.5" /></button>
      </div>
      <div className={styles.cardBody}>
        {data ? <Renderer data={data} /> : <div className={styles.loading}>{t('loading')}</div>}
      </div>
      <button
        className={styles.resizeHandle}
        aria-label={t('resize')}
        onClick={() => onResize(Math.min(12, card.layout.w + 2), card.layout.h + 1)}
      />
    </div>
  );
}
