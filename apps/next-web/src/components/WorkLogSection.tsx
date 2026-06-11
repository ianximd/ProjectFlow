'use client';

import { useEffect, useState, useTransition } from 'react';
import { addWorkLog, editWorkLog, deleteWorkLog, loadWorkLogs, startTimer } from '@/server/actions/worklogs';
import { loadSpaceTags } from '@/server/actions/tags';
import { notifyActionError } from '@/lib/apiErrorToast';
import { formatDuration, parseDuration } from '@/lib/duration';
import styles from './WorkLogSection.module.css';
import type { WorkLog, WorkLogTotals, WorkLogListResult, Tag } from '@projectflow/types';
import { useTranslations } from 'next-intl';

// ── helpers ──────────────────────────────────────────────────────────────────

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
  /** Space (project) id the task belongs to — used to load taggable tags. */
  spaceId?: string | null;
}

export function WorkLogSection({ taskId, currentUserId, spaceId }: Props) {
  const t  = useTranslations('WorkLog');
  const tt = useTranslations('Timer');
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

  const [billable, setBillable]             = useState(false);
  const [mode, setMode]                     = useState<'manual' | 'range'>('manual');
  const [rangeStart, setRangeStart]         = useState('');
  const [rangeEnd, setRangeEnd]             = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [spaceTags, setSpaceTags]           = useState<Tag[]>([]);

  const refetch = () => loadWorkLogs(taskId).then((d) => {
    setData(d);
    setLoaded(true);
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (taskId) refetch();
  }, [taskId]);

  useEffect(() => {
    if (spaceId) loadSpaceTags(spaceId).then(setSpaceTags).catch(() => {});
  }, [spaceId]);

  // Keep the log list in sync when a timer is started/stopped elsewhere
  // (e.g. the global timer widget), so the just-closed entry appears here.
  useEffect(() => {
    const onTimerChanged = () => { if (taskId) refetch(); };
    window.addEventListener('worklog:timer-changed', onTimerChanged as EventListener);
    return () => window.removeEventListener('worklog:timer-changed', onTimerChanged as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  function resetForm() {
    setError(null); setTimeInput(''); setDescInput(''); setRangeStart(''); setRangeEnd('');
    setBillable(false); setSelectedTagIds([]); setShowForm(false);
  }

  const toggleTag = (id: string) =>
    setSelectedTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const onCreate = () => {
    if (mode === 'manual') {
      const secs = parseDuration(timeInput);
      if (!secs) { setError(t('invalidTimeFormat')); return; }
      start(async () => {
        const r = await addWorkLog(taskId, {
          timeSpentSeconds: secs,
          startedAt:        new Date(dateInput).toISOString(),
          description:      descInput.trim() || undefined,
          billable,
          source:           'manual',
          tagIds:           selectedTagIds.length ? selectedTagIds : undefined,
        });
        if (!r.ok) { setError(r.error); notifyActionError(r); return; }
        resetForm(); await refetch();
      });
    } else {
      if (!rangeStart || !rangeEnd) { setError(t('invalidRange')); return; }
      const startIso = new Date(rangeStart).toISOString();
      const endIso   = new Date(rangeEnd).toISOString();
      const secs = Math.max(0, Math.floor((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000));
      if (secs <= 0) { setError(t('invalidRange')); return; }
      start(async () => {
        const r = await addWorkLog(taskId, {
          timeSpentSeconds: secs, startedAt: startIso, endedAt: endIso,
          description: descInput.trim() || undefined, billable, source: 'range',
          tagIds: selectedTagIds.length ? selectedTagIds : undefined,
        });
        if (!r.ok) { setError(r.error); notifyActionError(r); return; }
        resetForm(); await refetch();
      });
    }
  };

  const onStartTimerHere = () => start(async () => {
    const r = await startTimer(taskId);
    if (!r.ok) { notifyActionError(r); return; }
    window.dispatchEvent(new CustomEvent('worklog:timer-changed'));
  });

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
          {/* manual / range mode toggle */}
          <div className={styles.formRow} role="group" style={{ gap: 8 }}>
            <button
              type="button"
              className={styles.logBtn}
              aria-pressed={mode === 'manual'}
              style={{ fontWeight: mode === 'manual' ? 600 : 400 }}
              onClick={() => setMode('manual')}
            >{t('modeManual')}</button>
            <button
              type="button"
              className={styles.logBtn}
              aria-pressed={mode === 'range'}
              style={{ fontWeight: mode === 'range' ? 600 : 400 }}
              onClick={() => setMode('range')}
            >{t('modeRange')}</button>
          </div>

          {mode === 'manual' ? (
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
          ) : (
            <div className={styles.formRow}>
              <div className={styles.formField}>
                <label className={styles.fieldLabel}>{t('rangeStart')}</label>
                <input
                  className={styles.input}
                  type="datetime-local"
                  value={rangeStart}
                  onChange={e => setRangeStart(e.target.value)}
                />
              </div>
              <div className={styles.formField}>
                <label className={styles.fieldLabel}>{t('rangeEnd')}</label>
                <input
                  className={styles.input}
                  type="datetime-local"
                  value={rangeEnd}
                  onChange={e => setRangeEnd(e.target.value)}
                />
              </div>
            </div>
          )}

          <textarea
            className={styles.textarea}
            placeholder={t('workDescPlaceholder')}
            value={descInput}
            onChange={e => setDescInput(e.target.value)}
          />

          <label className={styles.fieldLabel} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={billable} onChange={e => setBillable(e.target.checked)} />
            {t('billable')}
          </label>

          {spaceTags.length > 0 && (
            <div className={styles.formField}>
              <label className={styles.fieldLabel}>{t('tags')}</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {spaceTags.map((tag) => {
                  const on = selectedTagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleTag(tag.id)}
                      style={{
                        padding: '2px 10px', borderRadius: 999, cursor: 'pointer',
                        fontSize: '0.75rem', lineHeight: 1.6,
                        border: '1px solid var(--border, #d0d0d0)',
                        background: on ? (tag.color ?? 'var(--accent, #2563eb)') : 'transparent',
                        color: on ? '#fff' : 'inherit',
                      }}
                    >{tag.name}</button>
                  );
                })}
              </div>
            </div>
          )}

          <div className={styles.formActions}>
            <button
              className={styles.saveBtn}
              onClick={onCreate}
              disabled={pending || (mode === 'manual' ? !timeInput.trim() : !(rangeStart && rangeEnd))}
            >
              {pending ? t('saving') : t('save')}
            </button>
            <button
              className={styles.logBtn}
              type="button"
              onClick={onStartTimerHere}
              disabled={pending}
            >
              {tt('startHere')}
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
          <div key={log.id} className={styles.logItem} data-worklog-source={log.source}>
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
                      {log.endedAt === null && (
                        <span style={{ marginLeft: 6, padding: '1px 6px', borderRadius: 4, fontSize: '0.7rem', background: 'var(--accent, #2563eb)', color: '#fff' }}>
                          {t('running')}
                        </span>
                      )}
                      {log.billable && (
                        <span style={{ marginLeft: 6, padding: '1px 6px', borderRadius: 4, fontSize: '0.7rem', background: 'var(--success, #16a34a)', color: '#fff' }}>
                          {t('billable')}
                        </span>
                      )}
                    </span>
                    {log.tags && log.tags.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                        {log.tags.map((tag) => (
                          <span
                            key={tag.id}
                            style={{
                              padding: '1px 8px', borderRadius: 999, fontSize: '0.7rem',
                              border: '1px solid var(--border, #d0d0d0)',
                              background: tag.color ?? 'transparent',
                              color: tag.color ? '#fff' : 'inherit',
                            }}
                          >{tag.name}</span>
                        ))}
                      </div>
                    )}
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
