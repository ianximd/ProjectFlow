'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { SprintSettings } from '@projectflow/types';

interface Props {
  folderId: string;
  settings: SprintSettings;
  onSave: (next: SprintSettings) => void;
}

export function SprintSetup({ folderId, settings, onSave }: Props) {
  const t = useTranslations('Sprints');
  const [s, setS] = useState<SprintSettings>(settings);

  const upd = (patch: Partial<SprintSettings>) => setS((prev) => ({ ...prev, ...patch }));

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSave({ ...s, folderId }); }}
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <h3>{t('setupTitle')}</h3>

      <label>
        <span>{t('durationDays')}</span>
        <input
          type="number" min={1} value={s.durationDays}
          onChange={(e) => upd({ durationDays: Math.max(1, Number(e.target.value)) })}
        />
      </label>

      <label>
        <span>{t('startDayOfWeek')}</span>
        <select
          value={s.startDayOfWeek ?? ''}
          onChange={(e) => upd({ startDayOfWeek: e.target.value === '' ? null : Number(e.target.value) })}
        >
          <option value="">—</option>
          {[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </label>

      <label>
        <input type="checkbox" checked={s.autoStart} onChange={(e) => upd({ autoStart: e.target.checked })} />
        <span>{t('autoStart')}</span>
      </label>
      <label>
        <input type="checkbox" checked={s.autoComplete} onChange={(e) => upd({ autoComplete: e.target.checked })} />
        <span>{t('autoComplete')}</span>
      </label>
      <label>
        <input type="checkbox" checked={s.autoRollForward} onChange={(e) => upd({ autoRollForward: e.target.checked })} />
        <span>{t('autoRollForward')}</span>
      </label>

      <button type="submit">{t('save')}</button>
    </form>
  );
}
