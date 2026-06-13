'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { updateCard } from '@/server/actions/dashboards';
import { notifyActionError } from '@/lib/apiErrorToast';
import type { CardConfig, DashboardCard, FilterGroup } from '@projectflow/types';

const AGG_OPS = ['count', 'sum', 'avg', 'min', 'max'] as const;

export function CardConfigDrawer({ card, onSaved, onClose }: { card: DashboardCard; onSaved: () => void; onClose: () => void }) {
  const t = useTranslations('DashboardCards');
  const [config, setConfig] = useState<CardConfig>(card.config);
  const [pending, start] = useTransition();

  const setFilter = (filter: FilterGroup) => setConfig((c) => ({ ...c, filter }));

  const save = () => start(async () => {
    const r = await updateCard(card.id, { config });
    if (!r.ok) return notifyActionError(r);
    onSaved(); onClose();
  });

  const showAgg = card.type === 'calculation' || card.type === 'bar';

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <div className="font-semibold">{t('configureCard')}</div>

      {showAgg && (
        <label className="flex items-center gap-2">
          <span className="w-20">{t('aggregate')}</span>
          <select
            className="border rounded px-1 py-0.5 bg-background"
            value={config.aggregate?.op ?? 'count'}
            onChange={(e) => setConfig((c) => ({ ...c, aggregate: { ...c.aggregate, op: e.target.value as any } }))}
          >
            {AGG_OPS.map((op) => <option key={op} value={op}>{t(`agg_${op}`)}</option>)}
          </select>
        </label>
      )}

      <PerCardFilter filter={config.filter ?? { conjunction: 'AND', rules: [] }} onChange={setFilter} />

      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <button className="px-2 py-1" onClick={onClose}>{t('cancel')}</button>
        <button className="px-2 py-1 rounded bg-primary text-primary-foreground" disabled={pending} onClick={save}>{t('save')}</button>
      </div>
    </div>
  );
}

function PerCardFilter({ filter, onChange }: { filter: FilterGroup; onChange: (f: FilterGroup) => void }) {
  const t = useTranslations('DashboardCards');
  const addRule = () => onChange({ ...filter, rules: [...filter.rules, { field: { kind: 'builtin', key: 'status' }, op: '=', value: '' }] });
  return (
    <section className="flex flex-col gap-2">
      <span className="font-semibold uppercase tracking-wide text-muted-foreground">{t('filters')}</span>
      {filter.rules.map((r, i) => (
        <div key={i} className="flex items-center gap-2" data-testid="card-filter-rule">
          <input
            className="border rounded px-1 py-0.5 bg-background w-40"
            value={String((r as any).value ?? '')}
            placeholder={t('valuePlaceholder')}
            onChange={(e) => {
              const rules = [...filter.rules];
              rules[i] = { ...(r as any), value: e.target.value };
              onChange({ ...filter, rules });
            }}
          />
          <button onClick={() => onChange({ ...filter, rules: filter.rules.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      <button className="px-2 py-1 rounded border w-fit" onClick={addRule} data-testid="card-add-filter">{t('addFilter')}</button>
    </section>
  );
}
