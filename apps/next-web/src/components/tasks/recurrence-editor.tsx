'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { notifyActionError } from '@/lib/apiErrorToast';
import {
  loadTaskRecurrence,
  setTaskRecurrence,
  clearTaskRecurrence,
} from '@/server/actions/recurrence';
import type {
  RecurrenceFreq,
  RecurrenceMode,
  RecurrenceRule,
  TaskRecurrence,
} from '@projectflow/types';

const FREQS: RecurrenceFreq[] = ['daily', 'weekly', 'monthly', 'yearly'];
const MODES: RecurrenceMode[] = ['on_complete', 'schedule', 'both'];
// 0=Sun..6=Sat, matches RecurrenceRule.byWeekday.
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
type EndKind = 'never' | 'on_date' | 'after';

const INPUT_STYLE: React.CSSProperties = {
  background: '#2d3748',
  border: '1px solid #4a5568',
  borderRadius: 6,
  color: '#e2e8f0',
  padding: '6px 10px',
  fontSize: 13,
  colorScheme: 'dark',
};

const LABEL_STYLE: React.CSSProperties = { fontSize: 12, color: '#a0aec0', minWidth: 92 };
const ROW_STYLE: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' };

// <input type="date"> wants "YYYY-MM-DD".
function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Recurrence editor for the task drawer. Shows the current rule as a human
 * summary when active, with Edit + Remove controls; the editor form builds a
 * RecurrenceRule (freq / interval / byWeekday for weekly / byMonthday for
 * monthly) plus an end condition (never → neither; on date → endsAt; after N →
 * count) and a regenerate mode. Save → setTaskRecurrence; a 422 bad rule surfaces
 * via the toast helper. Loads the current value on mount (mirrors the deps
 * section).
 */
export function RecurrenceEditor({
  taskId,
  onActiveChange,
}: {
  taskId: string;
  /** Reports whether the task has an active rule (load / save / clear) so the
   *  drawer can show a header recurring badge without a second fetch. */
  onActiveChange?: (active: boolean) => void;
}) {
  const t = useTranslations('Recurrence');
  const [current, setCurrent] = useState<TaskRecurrence | null>(null);
  const [editing, setEditing] = useState(false);
  const [, start] = useTransition();
  const [saving, setSaving] = useState(false);

  // Form state.
  const [freq, setFreq] = useState<RecurrenceFreq>('weekly');
  const [interval, setIntervalVal] = useState(1);
  const [byWeekday, setByWeekday] = useState<number[]>([]);
  const [byMonthday, setByMonthday] = useState(1);
  const [endKind, setEndKind] = useState<EndKind>('never');
  const [endsAt, setEndsAt] = useState('');
  const [count, setCount] = useState(10);
  const [regenerateMode, setRegenerateMode] = useState<RecurrenceMode>('on_complete');
  const [includeDependencies, setIncludeDependencies] = useState(false);

  // Adopt a new authoritative value and report its active-state to the parent.
  function adopt(r: TaskRecurrence | null) {
    setCurrent(r);
    onActiveChange?.(!!(r && r.active));
  }

  // Load the current rule on open / task switch (mirrors deps section).
  useEffect(() => {
    let cancelled = false;
    loadTaskRecurrence(taskId)
      .then((r) => { if (!cancelled) adopt(r); })
      .catch(() => { /* leave null */ });
    return () => { cancelled = true; };
    // adopt is stable for our purposes (only onActiveChange is external).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // Seed the form from a value (current rule on Edit, or sensible defaults).
  function seedForm(r: TaskRecurrence | null) {
    const rule = r?.rule;
    setFreq(rule?.freq ?? 'weekly');
    setIntervalVal(rule?.interval && rule.interval > 0 ? rule.interval : 1);
    setByWeekday(rule?.byWeekday ?? []);
    setByMonthday(rule?.byMonthday ?? 1);
    if (rule?.endsAt) { setEndKind('on_date'); setEndsAt(toDateInput(rule.endsAt)); }
    else if (rule?.count != null) { setEndKind('after'); setCount(rule.count); }
    else { setEndKind('never'); }
    setRegenerateMode(r?.regenerateMode ?? 'on_complete');
    setIncludeDependencies(r?.includeDependencies ?? false);
  }

  function openEditor() {
    seedForm(current);
    setEditing(true);
  }

  function toggleWeekday(d: number) {
    setByWeekday((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));
  }

  // Native weekday short names (locale-aware) — anchored on a known Sunday.
  const weekdayNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
    // 2024-01-07 is a Sunday.
    return WEEKDAYS.map((d) => fmt.format(new Date(2024, 0, 7 + d)));
  }, []);

  function buildRule(): RecurrenceRule {
    const rule: RecurrenceRule = { freq, interval: Math.max(1, Math.trunc(interval)) };
    if (freq === 'weekly' && byWeekday.length > 0) rule.byWeekday = [...byWeekday].sort((a, b) => a - b);
    if (freq === 'monthly') rule.byMonthday = Math.min(31, Math.max(1, Math.trunc(byMonthday)));
    if (endKind === 'on_date' && endsAt) rule.endsAt = new Date(`${endsAt}T00:00:00.000Z`).toISOString();
    if (endKind === 'after') rule.count = Math.max(1, Math.trunc(count));
    return rule;
  }

  function save() {
    setSaving(true);
    start(async () => {
      const r = await setTaskRecurrence(taskId, {
        rule: buildRule(),
        regenerateMode,
        includeDependencies,
      });
      setSaving(false);
      if (!r.ok) {
        // 422 bad rule (INVALID_RECURRENCE_RULE / WORKSPACE_MISMATCH) → curated toast.
        if (r.status === 422) {
          notifyActionError({ error: t('badRuleError'), code: r.code, status: r.status });
        } else {
          notifyActionError({ error: r.error || t('saveFailed'), code: r.code, status: r.status });
        }
        return;
      }
      adopt(r.data);
      setEditing(false);
    });
  }

  function remove() {
    setSaving(true);
    start(async () => {
      const r = await clearTaskRecurrence(taskId);
      setSaving(false);
      if (!r.ok) {
        notifyActionError({ error: r.error || t('removeFailed'), code: r.code, status: r.status });
        return;
      }
      adopt(null);
      setEditing(false);
    });
  }

  // Human summary, e.g. "Every 2 weeks on Mon, Wed".
  function summarize(r: TaskRecurrence): string {
    const rule = r.rule;
    const every =
      rule.interval > 1
        ? t('summaryEveryN', { n: rule.interval, unit: t(`unit_${rule.freq}` as const, { n: rule.interval }) })
        : t('summaryEvery', { unit: t(`unit1_${rule.freq}` as const) });
    let extra = '';
    if (rule.freq === 'weekly' && rule.byWeekday && rule.byWeekday.length > 0) {
      const days = [...rule.byWeekday].sort((a, b) => a - b).map((d) => weekdayNames[d]).join(', ');
      extra = ` ${t('summaryOnDays', { days })}`;
    } else if (rule.freq === 'monthly' && rule.byMonthday) {
      extra = ` ${t('summaryOnMonthday', { day: rule.byMonthday })}`;
    }
    return `${every}${extra}`;
  }

  // ---- Active summary view (not editing) ----
  if (current && current.active && !editing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: '#2d3748',
            border: '1px solid #4a5568',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 13,
            color: '#e2e8f0',
          }}
        >
          <span aria-hidden="true" title={t('badge')}>🔁</span>
          <span style={{ flex: 1 }}>{summarize(current)}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={openEditor} disabled={saving} style={secondaryBtnStyle(saving)}>
            {t('edit')}
          </button>
          <button type="button" onClick={remove} disabled={saving} style={dangerBtnStyle(saving)}>
            {t('remove')}
          </button>
        </div>
      </div>
    );
  }

  // ---- Empty state (no rule, not editing) ----
  if (!editing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 13, color: '#718096' }}>{t('none')}</span>
        <div>
          <button
            type="button"
            onClick={openEditor}
            style={{
              background: 'transparent',
              border: '1px dashed #4a5568',
              borderRadius: 6,
              padding: '3px 10px',
              fontSize: 12,
              color: '#a0aec0',
              cursor: 'pointer',
            }}
          >
            {t('add')}
          </button>
        </div>
      </div>
    );
  }

  // ---- Editor form ----
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={ROW_STYLE}>
        <span style={LABEL_STYLE}>{t('frequencyLabel')}</span>
        <select
          aria-label={t('frequencyLabel')}
          value={freq}
          onChange={(e) => setFreq(e.target.value as RecurrenceFreq)}
          style={INPUT_STYLE}
        >
          {FREQS.map((f) => (
            <option key={f} value={f}>{t(`freq_${f}` as const)}</option>
          ))}
        </select>
      </div>

      <div style={ROW_STYLE}>
        <span style={LABEL_STYLE}>{t('intervalLabel')}</span>
        <input
          type="number"
          min={1}
          aria-label={t('intervalLabel')}
          value={interval}
          onChange={(e) => setIntervalVal(Number(e.target.value) || 1)}
          style={{ ...INPUT_STYLE, width: 80 }}
        />
        <span style={{ fontSize: 12, color: '#718096' }}>{t(`unit_${freq}` as const, { n: interval })}</span>
      </div>

      {freq === 'weekly' && (
        <div style={ROW_STYLE}>
          <span style={LABEL_STYLE}>{t('weekdaysLabel')}</span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {WEEKDAYS.map((d) => {
              const on = byWeekday.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleWeekday(d)}
                  style={{
                    background: on ? '#3182ce' : '#2d3748',
                    border: `1px solid ${on ? '#3182ce' : '#4a5568'}`,
                    borderRadius: 6,
                    color: on ? '#fff' : '#a0aec0',
                    padding: '4px 8px',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  {weekdayNames[d]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {freq === 'monthly' && (
        <div style={ROW_STYLE}>
          <span style={LABEL_STYLE}>{t('monthdayLabel')}</span>
          <input
            type="number"
            min={1}
            max={31}
            aria-label={t('monthdayLabel')}
            value={byMonthday}
            onChange={(e) => setByMonthday(Number(e.target.value) || 1)}
            style={{ ...INPUT_STYLE, width: 80 }}
          />
        </div>
      )}

      <div style={ROW_STYLE}>
        <span style={LABEL_STYLE}>{t('endLabel')}</span>
        <select
          aria-label={t('endLabel')}
          value={endKind}
          onChange={(e) => setEndKind(e.target.value as EndKind)}
          style={INPUT_STYLE}
        >
          <option value="never">{t('endNever')}</option>
          <option value="on_date">{t('endOnDate')}</option>
          <option value="after">{t('endAfter')}</option>
        </select>
        {endKind === 'on_date' && (
          <input
            type="date"
            aria-label={t('endOnDate')}
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            style={INPUT_STYLE}
          />
        )}
        {endKind === 'after' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number"
              min={1}
              aria-label={t('endAfter')}
              value={count}
              onChange={(e) => setCount(Number(e.target.value) || 1)}
              style={{ ...INPUT_STYLE, width: 80 }}
            />
            <span style={{ fontSize: 12, color: '#718096' }}>{t('occurrences')}</span>
          </span>
        )}
      </div>

      <div style={ROW_STYLE}>
        <span style={LABEL_STYLE}>{t('regenerateLabel')}</span>
        <select
          aria-label={t('regenerateLabel')}
          value={regenerateMode}
          onChange={(e) => setRegenerateMode(e.target.value as RecurrenceMode)}
          style={INPUT_STYLE}
        >
          {MODES.map((m) => (
            <option key={m} value={m}>{t(`mode_${m}` as const)}</option>
          ))}
        </select>
      </div>

      <div style={ROW_STYLE}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#a0aec0', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={includeDependencies}
            onChange={(e) => setIncludeDependencies(e.target.checked)}
          />
          {t('includeDependencies')}
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={save} disabled={saving} style={primaryBtnStyle(saving)}>
          {saving ? t('saving') : t('save')}
        </button>
        <button type="button" onClick={() => setEditing(false)} disabled={saving} style={secondaryBtnStyle(saving)}>
          {t('cancel')}
        </button>
      </div>
    </div>
  );
}

function primaryBtnStyle(busy: boolean): React.CSSProperties {
  return {
    background: '#3182ce',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 500,
    cursor: busy ? 'progress' : 'pointer',
  };
}

function secondaryBtnStyle(busy: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    color: '#a0aec0',
    border: '1px solid #4a5568',
    borderRadius: 6,
    padding: '6px 14px',
    fontSize: 13,
    cursor: busy ? 'progress' : 'pointer',
  };
}

function dangerBtnStyle(busy: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    color: '#fc8181',
    border: '1px solid #4a5568',
    borderRadius: 6,
    padding: '6px 14px',
    fontSize: 13,
    cursor: busy ? 'progress' : 'pointer',
  };
}
