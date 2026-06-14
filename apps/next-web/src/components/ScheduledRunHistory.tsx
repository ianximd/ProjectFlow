'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import type { ScheduledReportRun, ScheduledReportStatus } from '@projectflow/types';
import { listScheduleRuns } from '@/server/actions/scheduled-reports';
import styles from './ScheduledRunHistory.module.css';

interface ScheduledRunHistoryProps {
  scheduleId: string;
}

const STATUS_KEY: Record<ScheduledReportStatus, 'statusDelivered' | 'statusFailed' | 'statusSkipped'> = {
  delivered: 'statusDelivered',
  failed:    'statusFailed',
  skipped:   'statusSkipped',
};

/**
 * Read-only run-history panel for a single scheduled report. Loads the runs on
 * mount via the `listScheduleRuns` server action and renders one row per run
 * with a status badge, the localized ran-at timestamp, and (when a snapshot was
 * frozen) a link to the read-only snapshot viewer. Purely presentational — it
 * never mutates the schedule.
 */
export function ScheduledRunHistory({ scheduleId }: ScheduledRunHistoryProps) {
  const t = useTranslations('ScheduledReport');
  const format = useFormatter();
  const [runs, setRuns] = useState<ScheduledReportRun[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const r = await listScheduleRuns(scheduleId);
      if (!active) return;
      if (r.ok) setRuns(r.data ?? []);
      setLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, [scheduleId]);

  return (
    <section className={styles.panel}>
      <h3 className={styles.heading}>{t('runHistory')}</h3>
      {loaded && runs.length === 0 ? (
        <p className={styles.empty}>{t('noRuns')}</p>
      ) : (
        <ul className={styles.list}>
          {runs.map((run) => {
            const statusKey = STATUS_KEY[run.status] ?? 'statusSkipped';
            return (
              <li key={run.id} className={styles.row} data-run-status={run.status}>
                <span className={`${styles.badge} ${styles[`badge_${run.status}`] ?? ''}`}>
                  {t(statusKey)}
                </span>
                <span className={styles.ranAt}>
                  {format.dateTime(new Date(run.ranAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </span>
                {run.snapshotRef ? (
                  <Link
                    className={styles.link}
                    href={`/reports/snapshot/${run.id}?scheduleId=${encodeURIComponent(scheduleId)}`}
                  >
                    {t('openSnapshot')}
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default ScheduledRunHistory;
