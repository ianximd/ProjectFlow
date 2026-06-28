'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AuditLogPage } from '@projectflow/types';
import { loadTaskActivity } from '@/server/actions/activity';
import { formatAuditEntry, groupByDay } from './auditDiff';
import styles from './ActivityTab.module.css';

export function ActivityTab({ taskId }: { taskId: string }) {
  const t = useTranslations('Activity');
  const [page, setPage] = useState<AuditLogPage | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    setState('loading');
    loadTaskActivity(taskId)
      .then((p) => { if (!active) return; if (p) { setPage(p); setState('ready'); } else setState('error'); })
      .catch(() => { if (active) setState('error'); });
    return () => { active = false; };
  }, [taskId]);

  if (state === 'loading') return <p className={styles.muted}>{t('tabLoading')}</p>;
  if (state === 'error')   return <p className={styles.muted}>{t('tabError')}</p>;
  if (!page || page.entries.length === 0) return <p className={styles.muted}>{t('tabEmpty')}</p>;

  return (
    <div className={styles.feed}>
      {groupByDay(page.entries).map(({ day, entries }) => (
        <section key={day} className={styles.dayGroup}>
          <h4 className={styles.dayLabel}>{day}</h4>
          {entries.map((e) => {
            const f = formatAuditEntry(e);
            return (
              <div key={e.id} className={styles.entry}>
                <div className={styles.summary}>{f.summary}</div>
                {f.changes.map((c) => (
                  <div key={c.field} className={styles.change}>
                    <span className={styles.field}>{c.field}</span>
                    <span className={styles.from}>{c.from}</span>
                    <span className={styles.arrow} aria-hidden="true">→</span>
                    <span className={styles.to}>{c.to}</span>
                  </div>
                ))}
                <time className={styles.time}>{new Date(e.createdAt).toLocaleTimeString()}</time>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
