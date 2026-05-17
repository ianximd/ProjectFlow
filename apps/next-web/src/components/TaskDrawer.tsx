'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CommentSection }  from './CommentSection';
import { AttachmentSection } from './AttachmentSection';
import { WorkLogSection }  from './WorkLogSection';
import { PullRequestsSection } from './PullRequestsSection';
import type { AssigneeRow } from './TaskCard';
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
  // The board / backlog pages already hold per-task assignees in their
  // list-query meta; they pass the slice for this task in. The drawer
  // owns no fetch for the *current* set — only for the picker dropdown.
  assignees?: AssigneeRow[];
  // Parents resolve workspaceId as `currentWorkspaceId ?? workspaces[0].Id`.
  // If they don't pass it down, the drawer's picker can't load members
  // because the store value may be null even when the board has a workspace.
  workspaceId?: string | null;
  onClose: () => void;
}

interface WorkspaceMember {
  Id:        string;
  Email:     string;
  Name:      string;
  AvatarUrl: string | null;
}

function initialsOf(nameOrEmail: string): string {
  const s = nameOrEmail.trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const PRIORITY_COLOR: Record<string, string> = {
  HIGHEST: '#e53e3e',
  HIGH:    '#ed8936',
  MEDIUM:  '#ecc94b',
  LOW:     '#48bb78',
  LOWEST:  '#a0aec0',
};

const PRIORITY_OPTIONS = ['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'] as const;

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

export function TaskDrawer({ task, assignees, workspaceId: workspaceIdProp, onClose }: Props) {
  const drawerRef   = useRef<HTMLDivElement>(null);
  const pickerRef   = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  // Prefer the parent's resolved workspace; fall back to the store. Either
  // covers the case where currentWorkspaceId hasn't been written yet but the
  // board still rendered via its workspaces[0] fallback.
  const storeWorkspaceId = useStore((s) => s.currentWorkspaceId);
  const workspaceId = workspaceIdProp ?? storeWorkspaceId;

  // Seed the editable dates from whichever casing the task arrived in.
  // Hooks must run unconditionally, so this stays above the `!task` short-circuit.
  const initialStartIso = task?.StartDate ?? task?.startDate ?? null;
  const initialDueIso   = task?.DueDate   ?? task?.dueDate   ?? null;
  const [startInput, setStartInput] = useState<string>(toDateInput(initialStartIso));
  const [dueInput,   setDueInput]   = useState<string>(toLocalInput(initialDueIso));

  // The drawer is opened with a `task` snapshot owned by the parent — that
  // snapshot is NOT refreshed when ['tasks'] invalidates, so a controlled
  // priority <select> bound directly to task.Priority would snap back to the
  // stale value after every PATCH. Mirror it locally instead.
  const [priorityValue, setPriorityValue] = useState<string>(
    task?.Priority ?? task?.priority ?? 'MEDIUM',
  );

  // Local mirror of assignees for instant chip feedback on add/remove.
  // The PUT response carries the authoritative new set; we resync to the
  // parent's prop on task switch or when the parent re-fetches ['tasks'].
  const [localAssignees, setLocalAssignees] = useState<AssigneeRow[]>(assignees ?? []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');

  // Re-sync the inputs when the drawer swaps to a different task.
  useEffect(() => {
    setStartInput(toDateInput(task?.StartDate ?? task?.startDate ?? null));
    setDueInput  (toLocalInput(task?.DueDate   ?? task?.dueDate   ?? null));
    setPriorityValue(task?.Priority ?? task?.priority ?? 'MEDIUM');
  }, [task?.Id, task?.id, task?.StartDate, task?.startDate, task?.DueDate, task?.dueDate, task?.Priority, task?.priority]);

  // Resync local assignee chips when the parent prop changes (task switch or
  // ['tasks'] refetch). Compared by stringified user-id list so re-rendering
  // with an equal-but-new array doesn't clobber an in-flight optimistic add.
  const assigneesKey = (assignees ?? []).map((a) => a.UserId).sort().join(',');
  useEffect(() => {
    setLocalAssignees(assignees ?? []);
    setPickerOpen(false);
    setPickerSearch('');
  }, [task?.Id, task?.id, assigneesKey]);

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

  const updatePriority = useMutation({
    mutationFn: async (priority: string) => {
      const token = useStore.getState().accessToken;
      const res = await fetch(`/api/v1/tasks/${mutationTaskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
        credentials: 'include',
        body: JSON.stringify({ priority }),
      });
      if (!res.ok) throw new Error(`Update failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['backlog-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-tasks'] });
    },
    onError: () => {
      // Roll back the local select to whatever the task prop says, so the
      // user sees the unchanged value rather than a phantom selection.
      setPriorityValue(task?.Priority ?? task?.priority ?? 'MEDIUM');
    },
  });

  // Members list is fetched lazily — only when the picker opens — so opening
  // a drawer for a task on a busy workspace doesn't fire an extra round-trip
  // the user never needed.
  const membersQuery = useQuery({
    queryKey: ['workspace-members', workspaceId],
    queryFn: async () => {
      const token = useStore.getState().accessToken;
      const res = await fetch(`/api/v1/workspaces/${workspaceId}/members`, {
        headers: { Authorization: `Bearer ${token ?? ''}` },
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Members fetch failed: ${res.status}`);
      const json = await res.json();
      return (json.data ?? []) as WorkspaceMember[];
    },
    enabled: pickerOpen && !!workspaceId,
    staleTime: 60_000,
  });

  // PUT replaces the full assignee set. SP silently drops non-members so a
  // stale picker can't grant access to someone outside the workspace.
  const setAssignees = useMutation({
    mutationFn: async (userIds: string[]) => {
      const token = useStore.getState().accessToken;
      const res = await fetch(`/api/v1/tasks/${mutationTaskId}/assignees`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
        credentials: 'include',
        body: JSON.stringify({ userIds }),
      });
      if (!res.ok) throw new Error(`Update failed: ${res.status}`);
      const json = await res.json();
      return (json.data ?? []) as AssigneeRow[];
    },
    onSuccess: (rows) => {
      // The PUT response is the new authoritative set — adopt it locally
      // so the chip row matches the server even before ['tasks'] refetches.
      setLocalAssignees(rows);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['backlog-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-tasks'] });
    },
    onError: () => {
      // Roll back to whatever the parent last told us.
      setLocalAssignees(assignees ?? []);
    },
  });

  // Close the picker when the user clicks outside of it. We listen on the
  // drawer body (not document) so clicks on the overlay still close the
  // drawer rather than being eaten by the picker handler.
  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pickerOpen]);

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
            <select
              aria-label="Priority"
              value={priorityValue}
              onChange={(e) => {
                setPriorityValue(e.target.value);
                updatePriority.mutate(e.target.value);
              }}
              disabled={updatePriority.isPending}
              style={{
                background:    '#2d3748',
                border:        '1px solid #4a5568',
                borderRadius:  6,
                color:         PRIORITY_COLOR[priorityValue] ?? '#e2e8f0',
                padding:       '2px 8px',
                fontSize:      12,
                fontWeight:    600,
                letterSpacing: '0.04em',
                cursor:        updatePriority.isPending ? 'progress' : 'pointer',
                colorScheme:   'dark',
              }}
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            {storyPoints != null && (
              <span className={styles.metaBadge}>{storyPoints} pts</span>
            )}
            {updatePriority.isError && (
              <span style={{ color: '#fc8181', fontSize: 11 }}>
                Failed to update priority.
              </span>
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

          <div className={styles.section}>
            <p className={styles.sectionTitle}>Assignees</p>
            <div
              ref={pickerRef}
              style={{
                display:    'flex',
                flexWrap:   'wrap',
                gap:        6,
                alignItems: 'center',
                position:   'relative',
              }}
            >
              {localAssignees.map((a) => (
                <span
                  key={a.UserId}
                  title={a.Email}
                  style={{
                    display:      'inline-flex',
                    alignItems:   'center',
                    gap:          6,
                    background:   '#2d3748',
                    border:       '1px solid #4a5568',
                    borderRadius: 999,
                    padding:      '2px 8px 2px 2px',
                    fontSize:     12,
                    color:        '#e2e8f0',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width:           20,
                      height:          20,
                      borderRadius:    '50%',
                      background:      a.AvatarUrl ? '#1a202c' : '#4a5568',
                      backgroundImage: a.AvatarUrl ? `url(${a.AvatarUrl})` : undefined,
                      backgroundSize:  'cover',
                      display:         'inline-flex',
                      alignItems:      'center',
                      justifyContent:  'center',
                      fontSize:        9,
                      fontWeight:      600,
                      color:           '#e2e8f0',
                    }}
                  >
                    {!a.AvatarUrl && initialsOf(a.Name || a.Email)}
                  </span>
                  <span>{a.Name || a.Email}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${a.Name || a.Email}`}
                    onClick={() => {
                      const next = localAssignees.filter((x) => x.UserId !== a.UserId);
                      setLocalAssignees(next);
                      setAssignees.mutate(next.map((x) => x.UserId));
                    }}
                    disabled={setAssignees.isPending}
                    style={{
                      background: 'transparent',
                      color:      '#a0aec0',
                      border:     'none',
                      cursor:     setAssignees.isPending ? 'progress' : 'pointer',
                      padding:    '0 2px',
                      lineHeight: 1,
                      fontSize:   16,
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}

              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                disabled={!workspaceId || setAssignees.isPending}
                style={{
                  background:   'transparent',
                  border:       '1px dashed #4a5568',
                  borderRadius: 999,
                  padding:      '3px 10px',
                  fontSize:     12,
                  color:        '#a0aec0',
                  cursor:       (!workspaceId || setAssignees.isPending) ? 'default' : 'pointer',
                }}
              >
                + Assign
              </button>

              {pickerOpen && (
                <div
                  role="dialog"
                  aria-label="Pick assignee"
                  style={{
                    position:     'absolute',
                    top:          '100%',
                    left:         0,
                    marginTop:    4,
                    width:        300,
                    maxHeight:    300,
                    overflowY:    'auto',
                    background:   '#1a202c',
                    border:       '1px solid #4a5568',
                    borderRadius: 6,
                    zIndex:       10,
                    padding:      6,
                    boxShadow:    '0 6px 18px rgba(0,0,0,0.5)',
                  }}
                >
                  <input
                    type="text"
                    placeholder="Search members…"
                    value={pickerSearch}
                    onChange={(e) => setPickerSearch(e.target.value)}
                    autoFocus
                    style={{
                      width:        '100%',
                      boxSizing:    'border-box',
                      marginBottom: 6,
                      background:   '#2d3748',
                      border:       '1px solid #4a5568',
                      borderRadius: 4,
                      color:        '#e2e8f0',
                      padding:      '4px 8px',
                      fontSize:     12,
                      colorScheme:  'dark',
                    }}
                  />
                  {membersQuery.isPending && (
                    <p style={{ fontSize: 12, color: '#a0aec0', margin: '4px 6px' }}>
                      Loading members…
                    </p>
                  )}
                  {membersQuery.isError && (
                    <p style={{ fontSize: 12, color: '#fc8181', margin: '4px 6px' }}>
                      Failed to load members.
                    </p>
                  )}
                  {membersQuery.data && (() => {
                    const assignedIds = new Set(localAssignees.map((a) => a.UserId));
                    const q = pickerSearch.trim().toLowerCase();
                    const filtered = membersQuery.data
                      .filter((m) => !assignedIds.has(m.Id))
                      .filter((m) => {
                        if (!q) return true;
                        return (m.Name || '').toLowerCase().includes(q)
                            || (m.Email || '').toLowerCase().includes(q);
                      });
                    if (filtered.length === 0) {
                      return (
                        <p style={{ fontSize: 12, color: '#a0aec0', margin: '4px 6px' }}>
                          {q ? 'No members match.' : 'Everyone is already assigned.'}
                        </p>
                      );
                    }
                    return filtered.map((m) => (
                      <button
                        key={m.Id}
                        type="button"
                        onClick={() => {
                          const optimistic: AssigneeRow = {
                            TaskId:    mutationTaskId,
                            UserId:    m.Id,
                            Email:     m.Email,
                            Name:      m.Name,
                            AvatarUrl: m.AvatarUrl,
                          };
                          const next = [...localAssignees, optimistic];
                          setLocalAssignees(next);
                          setPickerOpen(false);
                          setPickerSearch('');
                          setAssignees.mutate(next.map((x) => x.UserId));
                        }}
                        style={{
                          display:    'flex',
                          alignItems: 'center',
                          gap:        8,
                          width:      '100%',
                          background: 'transparent',
                          border:     'none',
                          color:      '#e2e8f0',
                          padding:    '6px 4px',
                          borderRadius: 4,
                          cursor:     'pointer',
                          textAlign:  'left',
                          fontSize:   12,
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#2d3748')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            width:           22,
                            height:          22,
                            borderRadius:    '50%',
                            background:      m.AvatarUrl ? '#2d3748' : '#4a5568',
                            backgroundImage: m.AvatarUrl ? `url(${m.AvatarUrl})` : undefined,
                            backgroundSize:  'cover',
                            display:         'inline-flex',
                            alignItems:      'center',
                            justifyContent:  'center',
                            fontSize:        10,
                            fontWeight:      600,
                            color:           '#e2e8f0',
                          }}
                        >
                          {!m.AvatarUrl && initialsOf(m.Name || m.Email)}
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column' }}>
                          <span>{m.Name || m.Email}</span>
                          {m.Name && (
                            <span style={{ color: '#718096', fontSize: 10 }}>{m.Email}</span>
                          )}
                        </span>
                      </button>
                    ));
                  })()}
                </div>
              )}
            </div>
            {setAssignees.isError && (
              <p style={{ color: '#fc8181', fontSize: 12, margin: '6px 0 0 0' }}>
                Failed to update assignees.
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
