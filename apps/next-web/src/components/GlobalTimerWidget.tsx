'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { stopTimer, getActiveTimer } from '@/server/actions/worklogs';
import { notifyActionError } from '@/lib/apiErrorToast';
import { useTranslations } from 'next-intl';
import styles from './GlobalTimerWidget.module.css';
import type { WorkLog } from '@projectflow/types';

/** Format elapsed seconds → "1:01:01" (with hours) or "2:05" (under an hour). */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function GlobalTimerWidget() {
  const t = useTranslations('Timer');
  const [active, setActive] = useState<WorkLog | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pending, start] = useTransition();
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load the active timer on mount, on window focus, and whenever another
  // component (e.g. WorkLogSection) signals a change via 'worklog:timer-changed'.
  useEffect(() => {
    const refresh = () => { getActiveTimer().then((log) => setActive(log)).catch(() => {}); };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('worklog:timer-changed', refresh as EventListener);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('worklog:timer-changed', refresh as EventListener);
    };
  }, []);

  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (!active) { setElapsed(0); return; }
    const startedMs = new Date(active.startedAt).getTime();
    const update = () => setElapsed(Math.floor((Date.now() - startedMs) / 1000));
    update();
    tickRef.current = setInterval(update, 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [active]);

  const onStop = () => start(async () => {
    const r = await stopTimer();
    if (!r.ok) { notifyActionError(r); return; }
    setActive(null);
    // Let task-scoped views (WorkLogSection) refetch so the closed entry shows.
    window.dispatchEvent(new CustomEvent('worklog:timer-changed'));
  });

  if (!active) return null; // hidden when idle; tasks start it via WorkLogSection

  return (
    <div className={styles.root} aria-label={t('running')}>
      <span className={styles.dot} aria-hidden />
      <span className={styles.elapsed}>{formatElapsed(elapsed)}</span>
      <button className={styles.stopBtn} onClick={onStop} disabled={pending}>
        {pending ? t('stopping') : t('stop')}
      </button>
    </div>
  );
}
