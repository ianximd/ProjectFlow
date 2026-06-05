'use client';

import { useEffect, useState, useTransition } from 'react';
import { addWorkLog, editWorkLog, deleteWorkLog, loadWorkLogs } from '@/server/actions/worklogs';
import { notifyActionError } from '@/lib/apiErrorToast';
import styles from './WorkLogSection.module.css';
import type { WorkLog, WorkLogTotals, WorkLogListResult } from '@projectflow/types';
import { useTranslations } from 'next-intl';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Format seconds → "2h 30m" / "45m" / "30s" */
function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (!h && s) parts.push(`${s}s`);
  return parts.join(' ') || '0m';
}

/** Parse "1h 30m", "2h", "45m", "90m" → seconds */
function parseDuration(input: string): number | null {
  const str = input.trim().toLowerCase();
  let total = 0;
  const hMatch = str.match(/(\d+)\s*h/);
  const mMatch = str.match(/(\d+)\s*m/);
  const sMatch = str.match(/(\d+)\s*s/);
  if (hMatch) total += parseInt(hMatch[1], 10) * 3600;
  if (mMatch) total += parseInt(mMatch[1], 10) * 60;
  if (sMatch) total += parseInt(sMatch[1], 10);
  return total > 0 ? total : null;
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function initials(name: string) {
  return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
}

// ── component ─────────────────────────────────────────────────────────────────

interface Props {
  taskId: string;
  /** Current viewer's user id — controls edit/delete affordances. */
  currentUserId: string | null;
}

export function WorkLogSection({ taskId, currentUserId }: Props) {
  const t = useTranslations('WorkLog');
  const [data, setData]       = useState<WorkLogListResult | null>(null);
  const [loaded, setLoaded]   = useState(false);
  const [pending, start]      = useTransition();

  const [timeInput, setTimeInput]   = useState('');
  const [dateInput, setDateInput]   = useState(() => new Date().toISOString().slice(0, 10));
  const [descInput, setDescInput]   = useState('');
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [editTime,  setEditTime]    = useState('');
  const [editDesc,  setEditDesc]    = useState('');
  const [showForm,  setShowForm]    = useState(false);
  const [error,     setError]       = useState<string | null>(null);

  const refetch = () => loadWorkLogs(taskId).then((d) => {
    setData(d);
    setLoaded(true);
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (taskId) refetch();
  }, [taskId]);

  const onCreate = () => {
    const secs = parseDuration(timeInput);
    if (!secs) { setError(t('invalidTimeFormat')); return; }
    start(async () => {
      const r = await addWorkLog(taskId, {
        timeSpentSeconds: secs,
        startedAt:        new Date(dateInput).toISOString(),
        description:      descInput.trim() || undefined,
      });
      if (!r.ok) { setError(r.error); notifyActionError(r); return; }
      setError(null);
      setTimeInput('');
      setDescInput('');
      setShowForm(false);
      await refetch();
    });
  };

  const onUpdate = (id: string) => start(async () => {
    const secs = parseDuration(editTime);
    const r = await editWorkLog(id, {
      timeSpentSeconds: secs ?? undefined,
      description:      editDesc.trim() || undefined,
    });
    if (!r.ok) return notifyActionError(r);
    setEditingId(null);
    await refetch();
  });

  const onDelete = (id: string) => start(async () => {
    const r = await deleteWorkLog(id);
    if (!r.ok) return notifyActionError(r);
    await refetch();
  });

  const totalSeconds = data?.logs.reduce((s, l) => s + l.timeSpentSeconds, 0) ?? 0;

  return (
    <div className={styles.root}>
      {/* header */}
      <div className={styles.header}>
        <span className={styles.totalBadge}>
          {t('total', { duration: formatDuration(totalSeconds) })}
        </span>
        <button className={styles.logBtn} onClick={() => setShowForm(v => !v)}>
          {showForm ? t('cancelLogWork') : t('logWork')}
        </button>
      </div>

      {/* log work form */}
      {showForm && (
        <div className={styles.form}>
          <div className={styles.formRow}>
            <div className={styles.formField}>
              <label className={styles.fieldLabel}>{t('timeSpentLabel')}</label>
              <input
                className={styles.input}
                placeholder={t('timeSpentPlaceholder')}
                value={timeInput}
                onChange={e => setTimeInput(e.target.value)}
              />
            </div>
            <div className={styles.formField}>
              <label className={styles.fieldLabel}>{t('dateLabel')}</label>
              <input
                className={styles.input}
                type="date"
                value={dateInput}
                onChange={e => setDateInput(e.target.value)}
              />
            </div>
          </div>
          <textarea
            className={styles.textarea}
            placeholder={t('workDescPlaceholder')}
            value={descInput}
            onChange={e => setDescInput(e.target.value)}
          />
          <div className={styles.formActions}>
            <button
              className={styles.saveBtn}
              onClick={onCreate}
              disabled={pending || !timeInput.trim()}
            >
              {pending ? t('saving') : t('save')}
            </button>
          </div>
          {error && <p className={styles.error}>{error}</p>}
        </div>
      )}

      {/* totals by user */}
      {(data?.totals?.length ?? 0) > 0 && (
        <div className={styles.totals}>
          {data!.totals.map((tot: WorkLogTotals) => (
            <div key={tot.user.id} className={styles.totalRow}>
              <div className={styles.avatar}>{initials(tot.user.name)}</div>
              <span className={styles.userName}>{tot.user.name}</span>
              <span className={styles.userTotal}>{formatDuration(tot.totalSeconds)}</span>
            </div>
          ))}
        </div>
      )}

      {/* log list */}
      {!loaded && <p className={styles.empty}>{t('loading')}</p>}
      {loaded && data?.logs.length === 0 && (
        <p className={styles.empty}>{t('noWorkLogged')}</p>
      )}

      <div className={styles.logList}>
        {data?.logs.map((log: WorkLog) => (
          <div key={log.id} className={styles.logItem}>
            {editingId === log.id ? (
              <div className={styles.editForm}>
                <input
                  className={styles.input}
                  value={editTime}
                  onChange={e => setEditTime(e.target.value)}
                  placeholder={t('editTimePlaceholder')}
                />
                <textarea
                  className={styles.textarea}
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value)}
                  placeholder={t('descriptionPlaceholder')}
                />
                <div className={styles.formActions}>
                  <button
                    className={styles.saveBtn}
                    onClick={() => onUpdate(log.id)}
                    disabled={pending}
                  >{t('save')}</button>
                  <button className={styles.cancelBtn} onClick={() => setEditingId(null)}>{t('cancel')}</button>
                </div>
              </div>
            ) : (
              <>
                <div className={styles.logMeta}>
                  <div className={styles.avatar}>{initials(log.user.name)}</div>
                  <div className={styles.logInfo}>
                    <span className={styles.logUser}>{log.user.name}</span>
                    <span className={styles.logTime}>
                      {formatDuration(log.timeSpentSeconds)}
                      {' · '}
                      {new Date(log.startedAt).toLocaleDateString()}
                      {' · '}
                      {relativeTime(log.createdAt)}
                    </span>
                    {log.description && <p className={styles.logDesc}>{log.description}</p>}
                  </div>
                </div>
                {currentUserId === log.user.id && (
                  <div className={styles.logActions}>
                    <button
                      className={styles.editBtn}
                      onClick={() => {
                        setEditingId(log.id);
                        setEditTime(formatDuration(log.timeSpentSeconds));
                        setEditDesc(log.description ?? '');
                      }}
                    >{t('edit')}</button>
                    <button
                      className={styles.deleteBtn}
                      onClick={() => onDelete(log.id)}
                      disabled={pending}
                    >{t('delete')}</button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
