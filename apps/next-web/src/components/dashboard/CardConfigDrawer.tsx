'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { updateCard } from '@/server/actions/dashboards';
import { notifyActionError } from '@/lib/apiErrorToast';
import type { CardConfig, CardType, DashboardCard, FilterGroup } from '@projectflow/types';

const AGG_OPS = ['count', 'sum', 'avg', 'min', 'max'] as const;

/** Card types that show the sprint-id param input. */
const SPRINT_PARAM_TYPES: CardType[] = ['burndown', 'burnup', 'sprint_summary'];
/** Card types that show projectId + optional numSprints. */
const VELOCITY_PARAM_TYPES: CardType[] = ['velocity'];
/** Card types that show scopeType + scopeId + optional weeks. */
const SCOPE_PARAM_TYPES: CardType[] = ['cumulative_flow', 'lead_cycle_time'];
/** Card types that show scopeType (folder/list) + scopeIds. */
const PORTFOLIO_PARAM_TYPES: CardType[] = ['portfolio'];
/** Card types that show taskId param. */
const TIMESHEET_PARAM_TYPES: CardType[] = ['timesheet'];
/** Card types that show target number param. */
const BATTERY_PARAM_TYPES: CardType[] = ['battery'];

export function CardConfigDrawer({ card, onSaved, onClose }: { card: DashboardCard; onSaved: () => void; onClose: () => void }) {
  const t = useTranslations('DashboardCards');
  const tCards = useTranslations('Cards');
  const [config, setConfig] = useState<CardConfig>(card.config);
  const [pending, start] = useTransition();

  const setFilter = (filter: FilterGroup) => setConfig((c) => ({ ...c, filter }));

  const setReportParam = (key: string, value: unknown) =>
    setConfig((c) => ({ ...c, reportParams: { ...c.reportParams, [key]: value } }));

  const save = () => start(async () => {
    const r = await updateCard(card.id, { config });
    if (!r.ok) return notifyActionError(r);
    onSaved(); onClose();
  });

  const showAgg = card.type === 'calculation' || card.type === 'bar';
  const rp = config.reportParams ?? {};

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

      {/* Sprint-based report params: burndown, burnup, sprint_summary */}
      {SPRINT_PARAM_TYPES.includes(card.type) && (
        <label className="flex items-center gap-2">
          <span className="w-20">{tCards('configSprint')} ID</span>
          <input
            className="border rounded px-1 py-0.5 bg-background flex-1"
            value={String(rp.sprintId ?? '')}
            placeholder="sprint-id"
            onChange={(e) => setReportParam('sprintId', e.target.value)}
          />
        </label>
      )}

      {/* Velocity params: projectId + optional numSprints */}
      {VELOCITY_PARAM_TYPES.includes(card.type) && (
        <>
          <label className="flex items-center gap-2">
            <span className="w-20">Project ID</span>
            <input
              className="border rounded px-1 py-0.5 bg-background flex-1"
              value={String(rp.projectId ?? '')}
              placeholder="project-id"
              onChange={(e) => setReportParam('projectId', e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-20"># Sprints</span>
            <input
              type="number"
              className="border rounded px-1 py-0.5 bg-background w-20"
              value={rp.numSprints !== undefined ? Number(rp.numSprints) : ''}
              placeholder="6"
              min={1}
              onChange={(e) => setReportParam('numSprints', e.target.value === '' ? undefined : Number(e.target.value))}
            />
          </label>
        </>
      )}

      {/* Scope params: cumulative_flow, lead_cycle_time */}
      {SCOPE_PARAM_TYPES.includes(card.type) && (
        <>
          <label className="flex items-center gap-2">
            <span className="w-20">{tCards('configScope')}</span>
            <select
              className="border rounded px-1 py-0.5 bg-background"
              value={String(rp.scopeType ?? 'list')}
              onChange={(e) => setReportParam('scopeType', e.target.value)}
            >
              <option value="space">Space</option>
              <option value="folder">Folder</option>
              <option value="list">List</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="w-20">Scope ID</span>
            <input
              className="border rounded px-1 py-0.5 bg-background flex-1"
              value={String(rp.scopeId ?? '')}
              placeholder="scope-id"
              onChange={(e) => setReportParam('scopeId', e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-20">{tCards('configWeeks')}</span>
            <input
              type="number"
              className="border rounded px-1 py-0.5 bg-background w-20"
              value={rp.weeks !== undefined ? Number(rp.weeks) : ''}
              placeholder="8"
              min={1}
              onChange={(e) => setReportParam('weeks', e.target.value === '' ? undefined : Number(e.target.value))}
            />
          </label>
        </>
      )}

      {/* Portfolio params: scopeType (folder/list) + scopeIds (comma-sep → string[]) */}
      {PORTFOLIO_PARAM_TYPES.includes(card.type) && (
        <>
          <label className="flex items-center gap-2">
            <span className="w-20">{tCards('configScope')}</span>
            <select
              className="border rounded px-1 py-0.5 bg-background"
              value={String(rp.scopeType ?? 'list')}
              onChange={(e) => setReportParam('scopeType', e.target.value)}
            >
              <option value="folder">Folder</option>
              <option value="list">List</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="w-20">Scope IDs</span>
            <input
              className="border rounded px-1 py-0.5 bg-background flex-1"
              value={Array.isArray(rp.scopeIds) ? (rp.scopeIds as string[]).join(', ') : String(rp.scopeIds ?? '')}
              placeholder="id1, id2, id3"
              onChange={(e) => {
                const ids = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                setReportParam('scopeIds', ids);
              }}
            />
          </label>
        </>
      )}

      {/* Timesheet params: taskId */}
      {TIMESHEET_PARAM_TYPES.includes(card.type) && (
        <label className="flex items-center gap-2">
          <span className="w-20">Task ID</span>
          <input
            className="border rounded px-1 py-0.5 bg-background flex-1"
            value={String(rp.taskId ?? '')}
            placeholder="task-id"
            onChange={(e) => setReportParam('taskId', e.target.value)}
          />
        </label>
      )}

      {/* Battery params: target */}
      {BATTERY_PARAM_TYPES.includes(card.type) && (
        <label className="flex items-center gap-2">
          <span className="w-20">{tCards('configTarget')}</span>
          <input
            type="number"
            className="border rounded px-1 py-0.5 bg-background w-24"
            value={rp.target !== undefined ? Number(rp.target) : ''}
            placeholder="100"
            min={0}
            onChange={(e) => setReportParam('target', e.target.value === '' ? undefined : Number(e.target.value))}
          />
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
