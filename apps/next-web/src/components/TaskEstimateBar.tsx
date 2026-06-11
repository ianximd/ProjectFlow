'use client';

import { useEffect, useState, useTransition } from 'react';
import { setEstimate, getRollup } from '@/server/actions/worklogs';
import type { TaskRollupResult } from '@/server/actions/worklogs';
import { notifyActionError } from '@/lib/apiErrorToast';
import { useTranslations } from 'next-intl';
import { formatDuration, parseDuration } from '@/lib/duration';
import styles from './TaskEstimateBar.module.css';

/**
 * Task time estimate + estimate-vs-actual bar + subtree rollup total.
 * Reads the rollup loader (returns the row directly, or null); setEstimate
 * returns an ActionResult whose `data` is the refreshed rollup.
 */
export function TaskEstimateBar({ taskId }: { taskId: string }) {
  const t = useTranslations('Estimate');
  const [rollup, setRollup] = useState<TaskRollupResult | null>(null);
  const [input, setInput]   = useState('');
  const [editing, setEditing] = useState(false);
  const [pending, start]    = useTransition();

  const refetch = () => getRollup(taskId).then((r) => setRollup(r)).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (taskId) refetch(); }, [taskId]);

  const onSave = () => start(async () => {
    const secs = parseDuration(input);
    const r = await setEstimate(taskId, secs);
    if (!r.ok) { notifyActionError(r); return; }
    setEditing(false);
    setInput('');
    setRollup(r.data);
  });

  if (!rollup) return null;
  const eva = rollup.estimateVsActual;
  const pct = eva.ratio === null ? 0 : Math.min(100, Math.round(eva.ratio * 100));

  return (
    <div className={styles.root} data-estimate-bar>
      <div className={styles.headerRow}>
        <span className={styles.label}>{t('estimate')}</span>
        {editing ? (
          <span className={styles.editRow}>
            <input
              className={styles.input}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="2h 30m"
            />
            <button className={styles.saveBtn} onClick={onSave} disabled={pending}>{t('save')}</button>
          </span>
        ) : (
          <button
            className={styles.editBtn}
            onClick={() => { setEditing(true); setInput(rollup.ownEstimateSeconds ? formatDuration(rollup.ownEstimateSeconds) : ''); }}
          >
            {rollup.ownEstimateSeconds ? formatDuration(rollup.ownEstimateSeconds) : t('setEstimate')}
          </button>
        )}
      </div>
      <div className={styles.barTrack}>
        <div className={`${styles.barFill} ${eva.overBudget ? styles.over : ''}`} style={{ width: `${pct}%` }} />
      </div>
      <div className={styles.legend}>
        <span>{t('logged', { duration: formatDuration(eva.loggedSeconds) })}</span>
        <span>{t('rollup', { duration: formatDuration(rollup.rollupLoggedSeconds) })}</span>
        {eva.remainingSeconds !== null && !eva.overBudget && (
          <span>{t('remaining', { duration: formatDuration(eva.remainingSeconds) })}</span>
        )}
        {eva.overBudget && <span className={styles.overText}>{t('overBudget')}</span>}
      </div>
    </div>
  );
}
