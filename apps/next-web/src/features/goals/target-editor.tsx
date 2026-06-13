'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { notifyActionError } from '@/lib/apiErrorToast';
import { createTarget, updateTarget } from '@/server/actions/goals';
import { Button } from '@/components/ui/button';
import type { Target, TargetKind } from '@projectflow/types';

interface TargetEditorProps {
  goalId: string;
  /** Provide to edit an existing target; omit to create a new one. */
  existing?: Target;
  onDone: () => void;
  onCancel: () => void;
}

const KINDS: TargetKind[] = ['number', 'boolean', 'currency', 'task'];

export function TargetEditor({ goalId, existing, onDone, onCancel }: TargetEditorProps) {
  const t = useTranslations('Goals');
  const [isPending, startTransition] = useTransition();

  const [kind, setKind] = useState<TargetKind>(existing?.kind ?? 'number');
  const [name, setName] = useState(existing?.name ?? '');
  const [unit, setUnit] = useState(existing?.unit ?? '');
  const [currencyCode, setCurrencyCode] = useState(existing?.currencyCode ?? '');
  const [startValue, setStartValue] = useState(String(existing?.startValue ?? '0'));
  const [targetValue, setTargetValue] = useState(String(existing?.targetValue ?? '100'));
  const [currentValue, setCurrentValue] = useState(String(existing?.currentValue ?? '0'));
  const [boolDone, setBoolDone] = useState((existing?.currentValue ?? 0) >= 1);
  // task: comma-separated task IDs
  const [taskIds, setTaskIds] = useState(() => {
    if (existing?.taskFilter) {
      try {
        const parsed = JSON.parse(existing.taskFilter) as { taskIds?: string[] };
        return (parsed.taskIds ?? []).join(', ');
      } catch {
        return '';
      }
    }
    return '';
  });

  function buildPayload() {
    const base = { kind, name };
    if (kind === 'boolean') {
      return { ...base, currentValue: boolDone ? 1 : 0 };
    }
    if (kind === 'task') {
      const ids = taskIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return { ...base, taskFilter: JSON.stringify({ taskIds: ids }) };
    }
    const sv = parseFloat(startValue);
    const tv = parseFloat(targetValue);
    const cv = parseFloat(currentValue);
    return {
      ...base,
      unit: unit || null,
      ...(kind === 'currency' ? { currencyCode: currencyCode || null } : {}),
      startValue: isNaN(sv) ? null : sv,
      targetValue: isNaN(tv) ? null : tv,
      currentValue: isNaN(cv) ? null : cv,
    };
  }

  function handleSave() {
    startTransition(async () => {
      const payload = buildPayload();
      const res = existing
        ? await updateTarget(goalId, existing.id, payload)
        : await createTarget(goalId, payload);
      if (!res.ok) notifyActionError(res);
      else onDone();
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      {/* Kind selector */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">{t('field.kind')}</label>
        <select
          className="rounded border bg-background px-2 py-1 text-sm"
          value={kind}
          onChange={(e) => setKind(e.target.value as TargetKind)}
          disabled={!!existing}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`kind.${k}`)}
            </option>
          ))}
        </select>
      </div>

      {/* Name */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">{t('field.name')}</label>
        <input
          className="rounded border bg-background px-2 py-1 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('field.name')}
        />
      </div>

      {/* Boolean: single checkbox */}
      {kind === 'boolean' && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={boolDone}
            onChange={(e) => setBoolDone(e.target.checked)}
          />
          {t('field.currentValue')}
        </label>
      )}

      {/* Task: comma-separated IDs (minimal selector — task picker limitation noted) */}
      {kind === 'task' && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">{t('taskPicker.label')}</label>
          <input
            className="rounded border bg-background px-2 py-1 text-sm font-mono"
            value={taskIds}
            onChange={(e) => setTaskIds(e.target.value)}
            placeholder="task-id-1, task-id-2"
          />
          <p className="text-xs text-muted-foreground">{t('taskPicker.hint')}</p>
        </div>
      )}

      {/* number / currency fields */}
      {(kind === 'number' || kind === 'currency') && (
        <>
          {kind === 'number' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">{t('field.unit')}</label>
              <input
                className="rounded border bg-background px-2 py-1 text-sm"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder={t('field.unit')}
              />
            </div>
          )}
          {kind === 'currency' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">{t('field.currencyCode')}</label>
              <input
                className="rounded border bg-background px-2 py-1 text-sm uppercase"
                value={currencyCode}
                onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())}
                placeholder="USD"
                maxLength={3}
              />
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">{t('field.startValue')}</label>
              <input
                type="number"
                className="rounded border bg-background px-2 py-1 text-sm"
                value={startValue}
                onChange={(e) => setStartValue(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">{t('field.targetValue')}</label>
              <input
                type="number"
                className="rounded border bg-background px-2 py-1 text-sm"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">{t('field.currentValue')}</label>
              <input
                type="number"
                className="rounded border bg-background px-2 py-1 text-sm"
                value={currentValue}
                onChange={(e) => setCurrentValue(e.target.value)}
              />
            </div>
          </div>
        </>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={isPending}>
          {t('cancel')}
        </Button>
        <Button size="sm" onClick={handleSave} disabled={isPending || !name.trim()}>
          {t('save')}
        </Button>
      </div>
    </div>
  );
}
