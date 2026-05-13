'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CommentSection }  from './CommentSection';
import { AttachmentSection } from './AttachmentSection';
import { WorkLogSection }  from './WorkLogSection';
import { PullRequestsSection } from './PullRequestsSection';
import { useStore } from '@/store/useStore';
import styles from './TaskDrawer.module.css';

interface Task {
  // camelCase (normalized)
  id?: string;
  issueKey?: string;
  title?: string;
  description?: string | null;
  status?: string;
  priority?: string;
  type?: string;
  storyPoints?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  // PascalCase (raw from API / SQL Server)
  Id?: string;
  IssueKey?: string;
  Title?: string;
  Description?: string | null;
  Status?: string;
  Priority?: string;
  Type?: string;
  StoryPoints?: number | null;
  StartDate?: string | null;
  DueDate?: string | null;
}

interface Props {
  task: Task | null;
  onClose: () => void;
}

const PRIORITY_COLOR: Record<string, string> = {
  HIGHEST: '#e53e3e',
  HIGH:    '#ed8936',
  MEDIUM:  '#ecc94b',
  LOW:     '#48bb78',
  LOWEST:  '#a0aec0',
};

// <input type="datetime-local"> reads/writes "YYYY-MM-DDTHH:mm" in *local* time.
// We hand-format because toISOString() returns UTC and would shift the visible
// hours by the user's offset.
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
       + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// <input type="date"> expects "YYYY-MM-DD". Tasks.StartDate is a DATE column
// (day-granular), so we drop any time component.
function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function TaskDrawer({ task, onClose }: Props) {
  const drawerRef   = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Seed the editable dates from whichever casing the task arrived in.
  // Hooks must run unconditionally, so this stays above the `!task` short-circuit.
  const initialStartIso = task?.StartDate ?? task?.startDate ?? null;
  const initialDueIso   = task?.DueDate   ?? task?.dueDate   ?? null;
  const [startInput, setStartInput] = useState<string>(toDateInput(initialStartIso));
  const [dueInput,   setDueInput]   = useState<string>(toLocalInput(initialDueIso));

  // Re-sync the inputs when the drawer swaps to a different task.
  useEffect(() => {
    setStartInput(toDateInput(task?.StartDate ?? task?.startDate ?? null));
    setDueInput  (toLocalInput(task?.DueDate   ?? task?.dueDate   ?? null));
  }, [task?.Id, task?.id, task?.StartDate, task?.startDate, task?.DueDate, task?.dueDate]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const mutationTaskId = task?.Id ?? task?.id ?? '';

  // Single endpoint covers both StartDate (DATE) and DueDate (DATETIME2). The
  // `clear*` flags tell the SP to actively NULL the column when we pass
  // an empty string — without them an undefined value would be a no-op.
  const updateSchedule = useMutation({
    mutationFn: async (input: { startIso: string | null; dueIso: string | null }) => {
      const token = useStore.getState().accessToken;
      const res = await fetch(`/api/v1/roadmap/tasks/${mutationTaskId}/dates`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
        credentials: 'include',
        body: JSON.stringify({
          startDate:      input.startIso,
          dueDate:        input.dueIso,
          clearStartDate: input.startIso === null,
          clearDueDate:   input.dueIso   === null,
        }),
      });
      if (!res.ok) throw new Error(`Update failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      // Refresh every cache that surfaces a task's schedule.
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['backlog-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['roadmap'] });
      queryClient.invalidateQueries({ queryKey: ['epics'] });
    },
  });

  if (!task) return null;

  // Normalize — API returns PascalCase, some callers may use camelCase
  const taskId      = task.Id     ?? task.id     ?? '';
  const issueKey    = task.IssueKey ?? task.issueKey;
  const title       = task.Title  ?? task.title  ?? '(untitled)';
  const description = task.Description ?? task.description;
  const status      = task.Status ?? task.status ?? '';
  const priority    = task.Priority ?? task.priority ?? '';
  const type        = task.Type   ?? task.type   ?? '';
  const storyPoints = task.StoryPoints ?? task.storyPoints;
  const startDate   = task.StartDate ?? task.startDate;
  const dueDate     = task.DueDate   ?? task.dueDate;

  return (
    <>
      <div className={styles.drawerOverlay} onClick={onClose} />
      <div className={styles.drawer} ref={drawerRef} role="dialog" aria-modal="true">
        <div className={styles.header}>
          <span className={styles.issueKey}>{issueKey ?? taskId.slice(0, 8).toUpperCase()}</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          <h2 className={styles.title}>{title}</h2>

          <div className={styles.meta}>
            <span className={styles.metaBadge}>{type}</span>
            <span className={styles.metaBadge}>{status}</span>
            <span
              className={styles.metaBadge}
              style={{ color: PRIORITY_COLOR[priority] ?? '#a0aec0' }}
            >
              {priority}
            </span>
            {storyPoints != null && (
              <span className={styles.metaBadge}>{storyPoints} pts</span>
            )}
          </div>

          {/* Editable schedule — Start (DATE) + Due (DATETIME2). Single Save
              hits PATCH /roadmap/tasks/:id/dates so the bar on the Gantt and
              the deadline chip on the board both refresh from one request. */}
          <div className={styles.section}>
            <p className={styles.sectionTitle}>Schedule</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <ScheduleRow
                label="Start date"
                kind="date"
                value={startInput}
                onChange={setStartInput}
                hasValue={!!startDate}
                onClear={() => {
                  setStartInput('');
                  updateSchedule.mutate({
                    startIso: null,
                    dueIso:   dueInput ? new Date(dueInput).toISOString() : null,
                  });
                }}
                disabled={updateSchedule.isPending}
              />
              <ScheduleRow
                label="Due date"
                kind="datetime"
                value={dueInput}
                onChange={setDueInput}
                hasValue={!!dueDate}
                onClear={() => {
                  setDueInput('');
                  updateSchedule.mutate({
                    startIso: startInput || null,
                    dueIso:   null,
                  });
                }}
                disabled={updateSchedule.isPending}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => updateSchedule.mutate({
                    startIso: startInput || null,
                    dueIso:   dueInput ? new Date(dueInput).toISOString() : null,
                  })}
                  disabled={
                    updateSchedule.isPending
                    || (startInput === toDateInput(startDate) && dueInput === toLocalInput(dueDate))
                  }
                  style={{
                    background:   '#3182ce',
                    color:        '#fff',
                    border:       'none',
                    borderRadius: 6,
                    padding:      '6px 14px',
                    fontSize:     13,
                    fontWeight:   500,
                    cursor:       (updateSchedule.isPending
                                   || (startInput === toDateInput(startDate) && dueInput === toLocalInput(dueDate)))
                                  ? 'default' : 'pointer',
                    opacity:      (updateSchedule.isPending
                                   || (startInput === toDateInput(startDate) && dueInput === toLocalInput(dueDate)))
                                  ? 0.5 : 1,
                  }}
                >
                  {updateSchedule.isPending ? 'Saving…' : 'Save schedule'}
                </button>
                <span style={{ fontSize: 11, color: '#718096' }}>
                  Start is day-granular; due supports time.
                </span>
              </div>
            </div>
            {updateSchedule.isError && (
              <p style={{ color: '#fc8181', fontSize: 12, margin: 0 }}>
                Failed to update schedule.
              </p>
            )}
          </div>

          {description && (
            <div className={styles.section}>
              <p className={styles.sectionTitle}>Description</p>
              <p className={styles.description}>{description}</p>
            </div>
          )}

          <div className={styles.section}>
            <p className={styles.sectionTitle}>Attachments</p>
            <AttachmentSection taskId={taskId} />
          </div>

          <div className={styles.section}>
            <p className={styles.sectionTitle}>Time Tracking</p>
            <WorkLogSection taskId={taskId} />
          </div>

          <div className={styles.section}>
            <p className={styles.sectionTitle}>Pull Requests & Commits</p>
            <PullRequestsSection taskId={taskId} />
          </div>

          <div className={styles.section}>
            <p className={styles.sectionTitle}>Comments</p>
            <CommentSection taskId={taskId} />
          </div>
        </div>
      </div>
    </>
  );
}

// Reusable date-input row used inside the Schedule section. Inline-styled to
// match the dark CSS-module drawer skin without pulling in another stylesheet.
function ScheduleRow({
  label, kind, value, onChange, hasValue, onClear, disabled,
}: {
  label:    string;
  kind:     'date' | 'datetime';
  value:    string;
  onChange: (v: string) => void;
  hasValue: boolean;
  onClear:  () => void;
  disabled: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, color: '#a0aec0', minWidth: 84 }}>{label}</span>
      <input
        type={kind === 'date' ? 'date' : 'datetime-local'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{
          background:   '#2d3748',
          border:       '1px solid #4a5568',
          borderRadius: 6,
          color:        '#e2e8f0',
          padding:      '6px 10px',
          fontSize:     13,
          colorScheme:  'dark',
        }}
      />
      {hasValue && (
        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          style={{
            background:   'transparent',
            color:        '#a0aec0',
            border:       '1px solid #4a5568',
            borderRadius: 6,
            padding:      '4px 10px',
            fontSize:     12,
            cursor:       disabled ? 'default' : 'pointer',
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
}
