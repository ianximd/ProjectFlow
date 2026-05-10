'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useStore } from '@/store/useStore';
import styles from './WorkLogSection.module.css';
import type { WorkLog, WorkLogTotals, WorkLogListResult } from '@projectflow/types';

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

async function apiReq<T>(path: string, opts: RequestInit, token: string): Promise<T> {
  const res = await fetch(path, {
    ...opts,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${token}`,
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.json();
}

// ── component ─────────────────────────────────────────────────────────────────

interface Props { taskId: string; }

export function WorkLogSection({ taskId }: Props) {
  const token      = useStore(s => s.accessToken) ?? '';
  const currentUser = useStore(s => s.user);
  const qc         = useQueryClient();

  const [timeInput, setTimeInput]   = useState('');
  const [dateInput, setDateInput]   = useState(() => new Date().toISOString().slice(0, 10));
  const [descInput, setDescInput]   = useState('');
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [editTime,  setEditTime]    = useState('');
  const [editDesc,  setEditDesc]    = useState('');
  const [showForm,  setShowForm]    = useState(false);

  const { data, isLoading } = useQuery<WorkLogListResult>({
    queryKey: ['worklogs', taskId],
    queryFn:  () =>
      apiReq<WorkLogListResult>(`/api/v1/worklogs?taskId=${taskId}`, {}, token),
    enabled: Boolean(taskId && token),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['worklogs', taskId] });

  const createMutation = useMutation({
    mutationFn: () => {
      const secs = parseDuration(timeInput);
      if (!secs) throw new Error('Invalid time format');
      return apiReq('/api/v1/worklogs', {
        method: 'POST',
        body: JSON.stringify({
          taskId,
          timeSpentSeconds: secs,
          startedAt: new Date(dateInput).toISOString(),
          description: descInput.trim() || undefined,
        }),
      }, token);
    },
    onSuccess: () => {
      invalidate();
      setTimeInput('');
      setDescInput('');
      setShowForm(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, time, desc }: { id: string; time: string; desc: string }) => {
      const secs = parseDuration(time);
      return apiReq(`/api/v1/worklogs/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          timeSpentSeconds: secs ?? undefined,
          description: desc.trim() || undefined,
        }),
      }, token);
    },
    onSuccess: () => { invalidate(); setEditingId(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiReq(`/api/v1/worklogs/${id}`, { method: 'DELETE' }, token),
    onSuccess: invalidate,
  });

  const totalSeconds = data?.logs.reduce((s, l) => s + l.timeSpentSeconds, 0) ?? 0;

  return (
    <div className={styles.root}>
      {/* header */}
      <div className={styles.header}>
        <span className={styles.totalBadge}>
          Total: <strong>{formatDuration(totalSeconds)}</strong>
        </span>
        <button className={styles.logBtn} onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : '+ Log work'}
        </button>
      </div>

      {/* log work form */}
      {showForm && (
        <div className={styles.form}>
          <div className={styles.formRow}>
            <div className={styles.formField}>
              <label className={styles.fieldLabel}>Time spent</label>
              <input
                className={styles.input}
                placeholder="e.g. 1h 30m"
                value={timeInput}
                onChange={e => setTimeInput(e.target.value)}
              />
            </div>
            <div className={styles.formField}>
              <label className={styles.fieldLabel}>Date</label>
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
            placeholder="Work description (optional)"
            value={descInput}
            onChange={e => setDescInput(e.target.value)}
          />
          <div className={styles.formActions}>
            <button
              className={styles.saveBtn}
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !timeInput.trim()}
            >
              {createMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
          {createMutation.isError && (
            <p className={styles.error}>{(createMutation.error as Error).message}</p>
          )}
        </div>
      )}

      {/* totals by user */}
      {(data?.totals?.length ?? 0) > 0 && (
        <div className={styles.totals}>
          {data!.totals.map((t: WorkLogTotals) => (
            <div key={t.user.id} className={styles.totalRow}>
              <div className={styles.avatar}>{initials(t.user.name)}</div>
              <span className={styles.userName}>{t.user.name}</span>
              <span className={styles.userTotal}>{formatDuration(t.totalSeconds)}</span>
            </div>
          ))}
        </div>
      )}

      {/* log list */}
      {isLoading && <p className={styles.empty}>Loading…</p>}
      {!isLoading && data?.logs.length === 0 && (
        <p className={styles.empty}>No work logged yet.</p>
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
                  placeholder="Time (e.g. 2h)"
                />
                <textarea
                  className={styles.textarea}
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value)}
                  placeholder="Description"
                />
                <div className={styles.formActions}>
                  <button
                    className={styles.saveBtn}
                    onClick={() => updateMutation.mutate({ id: log.id, time: editTime, desc: editDesc })}
                    disabled={updateMutation.isPending}
                  >Save</button>
                  <button className={styles.cancelBtn} onClick={() => setEditingId(null)}>Cancel</button>
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
                {currentUser?.id === log.user.id && (
                  <div className={styles.logActions}>
                    <button
                      className={styles.editBtn}
                      onClick={() => {
                        setEditingId(log.id);
                        setEditTime(formatDuration(log.timeSpentSeconds));
                        setEditDesc(log.description ?? '');
                      }}
                    >Edit</button>
                    <button
                      className={styles.deleteBtn}
                      onClick={() => deleteMutation.mutate(log.id)}
                      disabled={deleteMutation.isPending}
                    >Delete</button>
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
