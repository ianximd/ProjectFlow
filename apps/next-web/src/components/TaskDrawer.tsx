'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CommentSection }  from './CommentSection';
import { AttachmentSection } from './AttachmentSection';
import { WorkLogSection }  from './WorkLogSection';
import { PullRequestsSection } from './PullRequestsSection';
import type { AssigneeRow } from './TaskCard';
import {
  updateTaskFields,
  updateTaskSchedule,
  setTaskAssignees,
} from '@/server/actions/tasks';
import { loadWorkspaceMembers } from '@/server/actions/members';
import { getCurrentUserId } from '@/server/actions/auth';
import { notifyActionError } from '@/lib/apiErrorToast';
import type { MemberRow } from '@/server/queries/workspace';
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
  // The opener passes workspaceId (resolved as ctx.activeWorkspaceId) — required
  // for the member picker to load assignee candidates. null only when no
  // workspace has resolved yet; the store fallback was removed in Phase 3.1.
  workspaceId: string | null;
  onClose: () => void;
  /** Hierarchy (Phase 1): read-only Space / Folder / List breadcrumb. */
  breadcrumb?: { space: string; folder?: string; list?: string };
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

// <input type="date"> expects "YYYY-MM-DD". Used for both Start and Due — the
// drawer is day-granular end-to-end now.
function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function TaskDrawer({ task, assignees, workspaceId: workspaceIdProp, onClose, breadcrumb }: Props) {
  const drawerRef   = useRef<HTMLDivElement>(null);
  const pickerRef   = useRef<HTMLDivElement>(null);
  // Workspace comes from the opener as a prop (every render site passes
  // `ctx.activeWorkspaceId`). The drawer only opens on a task, which always
  // belongs to an active workspace, so a null prop is not expected here.
  const workspaceId = workspaceIdProp ?? null;

  // Viewer identity now comes from the server (the access-token cookie) instead
  // of the in-memory auth store. Threaded to the comment + worklog sections so
  // they can show edit/delete affordances for the current user's own rows.
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  useEffect(() => { getCurrentUserId().then(setCurrentUserId); }, []);

  // Seed the editable dates from whichever casing the task arrived in.
  // Hooks must run unconditionally, so this stays above the `!task` short-circuit.
  const initialStartIso = task?.StartDate ?? task?.startDate ?? null;
  const initialDueIso   = task?.DueDate   ?? task?.dueDate   ?? null;
  const [startInput, setStartInput] = useState<string>(toDateInput(initialStartIso));
  // Due is day-granular in the UI to match Start — operators were confused by
  // the mixed precision. The server column is DATETIME2 but the Gantt has
  // always sent day-only strings to this same endpoint, so the API accepts it.
  const [dueInput,   setDueInput]   = useState<string>(toDateInput(initialDueIso));

  // The drawer is opened with a `task` snapshot owned by the parent — that
  // snapshot is NOT refreshed when the parent re-renders, so a controlled
  // priority <select> bound directly to task.Priority would snap back to the
  // stale value after every PATCH. Mirror it locally instead.
  const [priorityValue, setPriorityValue] = useState<string>(
    task?.Priority ?? task?.priority ?? 'MEDIUM',
  );

  // Inline-edit state for title + description. We mirror the parent snapshot
  // so the UI is responsive on PATCH (no flash of stale text), then resync
  // on task switch + on successful PATCH so an out-of-band update wins.
  const initialTitle       = task?.Title ?? task?.title ?? '';
  const initialDescription = task?.Description ?? task?.description ?? '';
  const [titleValue,       setTitleValue]       = useState<string>(initialTitle);
  const [descriptionValue, setDescriptionValue] = useState<string>(initialDescription);
  const [editingDescription, setEditingDescription] = useState(false);
  const [draftDescription,   setDraftDescription]   = useState<string>(initialDescription);

  // Local mirror of assignees for instant chip feedback on add/remove.
  // The PUT response carries the authoritative new set; we resync to the
  // parent's prop on task switch or when the parent re-renders.
  const [localAssignees, setLocalAssignees] = useState<AssigneeRow[]>(assignees ?? []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');

  // Server-action transitions (one per concern, so each control disables
  // independently — matches the old per-mutation isPending behaviour).
  const [savingSchedule,  startSchedule]  = useTransition();
  const [scheduleError,   setScheduleError]  = useState(false);
  const [savingField,     startField]     = useTransition();
  const [fieldError,      setFieldError]     = useState(false);
  const [savingPriority,  startPriority]  = useTransition();
  const [priorityError,   setPriorityError]  = useState(false);
  const [savingAssignees, startAssignees] = useTransition();
  const [assigneesError,  setAssigneesError] = useState(false);

  // Members list is fetched lazily — only when the picker opens — so opening a
  // drawer for a task on a busy workspace doesn't fire an extra round-trip the
  // user never needed.
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [loadingMembers, startMembers] = useTransition();
  const [membersError, setMembersError] = useState(false);
  // Remember which workspace `members` was loaded for, so re-opening the picker
  // reuses the in-session cache instead of re-fetching every time (the old
  // react-query query had staleTime: 60_000).
  const loadedMembersWs = useRef<string | null>(null);

  // Re-sync the inputs when the drawer swaps to a different task. Title +
  // description follow the same pattern — local mirror so PATCH doesn't
  // flash stale text, but an out-of-band edit (e.g. someone else changes
  // the title) still wins on the next refetch.
  useEffect(() => {
    setStartInput(toDateInput(task?.StartDate ?? task?.startDate ?? null));
    setDueInput  (toDateInput(task?.DueDate   ?? task?.dueDate   ?? null));
    setPriorityValue(task?.Priority ?? task?.priority ?? 'MEDIUM');
    const t = task?.Title ?? task?.title ?? '';
    const d = task?.Description ?? task?.description ?? '';
    setTitleValue(t);
    setDescriptionValue(d);
    setDraftDescription(d);
    setEditingDescription(false);
  }, [task?.Id, task?.id, task?.StartDate, task?.startDate, task?.DueDate, task?.dueDate, task?.Priority, task?.priority, task?.Title, task?.title, task?.Description, task?.description]);

  // Resync local assignee chips when the parent prop changes (task switch or
  // refetch). Compared by stringified user-id list so re-rendering with an
  // equal-but-new array doesn't clobber an in-flight optimistic add.
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
  // `clear*` flags tell the SP to actively NULL the column when we pass an empty
  // string — without them an undefined value would be a no-op.
  const doUpdateSchedule = (input: { startIso: string | null; dueIso: string | null }) =>
    startSchedule(async () => {
      setScheduleError(false);
      const r = await updateTaskSchedule(mutationTaskId, {
        startDate:      input.startIso,
        dueDate:        input.dueIso,
        clearStartDate: input.startIso === null,
        clearDueDate:   input.dueIso   === null,
      });
      if (!r.ok) { setScheduleError(true); notifyActionError(r); }
    });

  // Shared PATCH for { title, description }. The action revalidates every list
  // route so board/backlog/dashboard/roadmap pick up the change without a
  // manual refresh.
  const doUpdateField = (input: { title?: string; description?: string | null }) =>
    startField(async () => {
      setFieldError(false);
      const r = await updateTaskFields(mutationTaskId, input);
      if (!r.ok) { setFieldError(true); notifyActionError(r); }
    });

  // Commit-on-blur for the title input. Trims, ignores no-op edits, and refuses
  // to send empty strings (server schema requires min length 1).
  const commitTitle = () => {
    const trimmed = titleValue.trim();
    const original = (task?.Title ?? task?.title ?? '').trim();
    if (trimmed === '' || trimmed === original) {
      setTitleValue(original); // reset display in case the user emptied it
      return;
    }
    doUpdateField({ title: trimmed });
  };

  const doUpdatePriority = (priority: string) =>
    startPriority(async () => {
      setPriorityError(false);
      const r = await updateTaskFields(mutationTaskId, { priority });
      if (!r.ok) {
        setPriorityError(true);
        notifyActionError(r);
        // Roll back the local select to whatever the task prop says.
        setPriorityValue(task?.Priority ?? task?.priority ?? 'MEDIUM');
      }
    });

  // PUT replaces the full assignee set. SP silently drops non-members so a stale
  // picker can't grant access to someone outside the workspace.
  const doSetAssignees = (userIds: string[]) =>
    startAssignees(async () => {
      setAssigneesError(false);
      const r = await setTaskAssignees(mutationTaskId, userIds);
      if (!r.ok) {
        setAssigneesError(true);
        notifyActionError(r);
        setLocalAssignees(assignees ?? []); // roll back to parent's last set
        return;
      }
      // The PUT response is the new authoritative set — adopt it locally so the
      // chip row matches the server even before the parent refetches.
      setLocalAssignees(r.data);
    });

  // Load workspace members when the picker opens — once per workspace per
  // session (re-opening reuses the cached list).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!pickerOpen || !workspaceId) return;
    if (loadedMembersWs.current === workspaceId && members) return;
    setMembersError(false);
    startMembers(async () => {
      try {
        setMembers(await loadWorkspaceMembers(workspaceId));
        loadedMembersWs.current = workspaceId;
      } catch {
        setMembersError(true);
      }
    });
  }, [pickerOpen, workspaceId]);

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
          {breadcrumb && (
            <nav
              aria-label="Hierarchy breadcrumb"
              style={{ display: 'flex', gap: 6, fontSize: 12, color: 'var(--muted-foreground, #6b7280)', marginBottom: 8, flexWrap: 'wrap' }}
            >
              <span>{breadcrumb.space}</span>
              {breadcrumb.folder && (<><span>/</span><span>{breadcrumb.folder}</span></>)}
              {breadcrumb.list && (<><span>/</span><span>{breadcrumb.list}</span></>)}
            </nav>
          )}
          {/* Click-to-edit title: behaves as an h2 visually but is actually a
              borderless textarea that grows with content. Enter commits and
              re-blurs (Shift+Enter for a newline, but titles are single-line
              so we discard newlines on commit). Escape reverts to the last
              saved value. */}
          <textarea
            className={styles.title}
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              } else if (e.key === 'Escape') {
                setTitleValue(task.Title ?? task.title ?? '');
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
            disabled={savingField}
            rows={1}
            aria-label="Issue title"
            placeholder="Untitled"
            style={{
              background:  'transparent',
              border:      'none',
              outline:     'none',
              resize:      'none',
              width:       '100%',
              padding:     0,
              fontFamily:  'inherit',
              colorScheme: 'dark',
            }}
          />

          <div className={styles.meta}>
            <span className={styles.metaBadge}>{type}</span>
            <span className={styles.metaBadge}>{status}</span>
            <select
              aria-label="Priority"
              value={priorityValue}
              onChange={(e) => {
                setPriorityValue(e.target.value);
                doUpdatePriority(e.target.value);
              }}
              disabled={savingPriority}
              style={{
                background:    '#2d3748',
                border:        '1px solid #4a5568',
                borderRadius:  6,
                color:         PRIORITY_COLOR[priorityValue] ?? '#e2e8f0',
                padding:       '2px 8px',
                fontSize:      12,
                fontWeight:    600,
                letterSpacing: '0.04em',
                cursor:        savingPriority ? 'progress' : 'pointer',
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
            {priorityError && (
              <span style={{ color: '#fc8181', fontSize: 11 }}>
                Failed to update priority.
              </span>
            )}
          </div>

          {/* Editable schedule — both Start and Due are day-granular. The
              server's DueDate column is DATETIME2, but the API has always
              accepted day-only strings (Gantt sends them on drag). Single Save
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
                  doUpdateSchedule({
                    startIso: null,
                    dueIso:   dueInput || null,
                  });
                }}
                disabled={savingSchedule}
              />
              <ScheduleRow
                label="Due date"
                kind="date"
                value={dueInput}
                onChange={setDueInput}
                hasValue={!!dueDate}
                onClear={() => {
                  setDueInput('');
                  doUpdateSchedule({
                    startIso: startInput || null,
                    dueIso:   null,
                  });
                }}
                disabled={savingSchedule}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => doUpdateSchedule({
                    startIso: startInput || null,
                    dueIso:   dueInput || null,
                  })}
                  disabled={
                    savingSchedule
                    || (startInput === toDateInput(startDate) && dueInput === toDateInput(dueDate))
                  }
                  style={{
                    background:   '#3182ce',
                    color:        '#fff',
                    border:       'none',
                    borderRadius: 6,
                    padding:      '6px 14px',
                    fontSize:     13,
                    fontWeight:   500,
                    cursor:       (savingSchedule
                                   || (startInput === toDateInput(startDate) && dueInput === toDateInput(dueDate)))
                                  ? 'default' : 'pointer',
                    opacity:      (savingSchedule
                                   || (startInput === toDateInput(startDate) && dueInput === toDateInput(dueDate)))
                                  ? 0.5 : 1,
                  }}
                >
                  {savingSchedule ? 'Saving…' : 'Save schedule'}
                </button>
              </div>
            </div>
            {scheduleError && (
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
                      doSetAssignees(next.map((x) => x.UserId));
                    }}
                    disabled={savingAssignees}
                    style={{
                      background: 'transparent',
                      color:      '#a0aec0',
                      border:     'none',
                      cursor:     savingAssignees ? 'progress' : 'pointer',
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
                disabled={!workspaceId || savingAssignees}
                style={{
                  background:   'transparent',
                  border:       '1px dashed #4a5568',
                  borderRadius: 999,
                  padding:      '3px 10px',
                  fontSize:     12,
                  color:        '#a0aec0',
                  cursor:       (!workspaceId || savingAssignees) ? 'default' : 'pointer',
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
                  {loadingMembers && (
                    <p style={{ fontSize: 12, color: '#a0aec0', margin: '4px 6px' }}>
                      Loading members…
                    </p>
                  )}
                  {membersError && (
                    <p style={{ fontSize: 12, color: '#fc8181', margin: '4px 6px' }}>
                      Failed to load members.
                    </p>
                  )}
                  {members && (() => {
                    const assignedIds = new Set(localAssignees.map((a) => a.UserId));
                    const q = pickerSearch.trim().toLowerCase();
                    const filtered = members
                      .filter((m) => !assignedIds.has(m.id))
                      .filter((m) => {
                        if (!q) return true;
                        return (m.name || '').toLowerCase().includes(q)
                            || (m.email || '').toLowerCase().includes(q);
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
                        key={m.id}
                        type="button"
                        onClick={() => {
                          const optimistic: AssigneeRow = {
                            TaskId:    mutationTaskId,
                            UserId:    m.id,
                            Email:     m.email,
                            Name:      m.name ?? '',
                            AvatarUrl: m.avatarUrl,
                          };
                          const next = [...localAssignees, optimistic];
                          setLocalAssignees(next);
                          setPickerOpen(false);
                          setPickerSearch('');
                          doSetAssignees(next.map((x) => x.UserId));
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
                            background:      m.avatarUrl ? '#2d3748' : '#4a5568',
                            backgroundImage: m.avatarUrl ? `url(${m.avatarUrl})` : undefined,
                            backgroundSize:  'cover',
                            display:         'inline-flex',
                            alignItems:      'center',
                            justifyContent:  'center',
                            fontSize:        10,
                            fontWeight:      600,
                            color:           '#e2e8f0',
                          }}
                        >
                          {!m.avatarUrl && initialsOf(m.name || m.email)}
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column' }}>
                          <span>{m.name || m.email}</span>
                          {m.name && (
                            <span style={{ color: '#718096', fontSize: 10 }}>{m.email}</span>
                          )}
                        </span>
                      </button>
                    ));
                  })()}
                </div>
              )}
            </div>
            {assigneesError && (
              <p style={{ color: '#fc8181', fontSize: 12, margin: '6px 0 0 0' }}>
                Failed to update assignees.
              </p>
            )}
          </div>

          {/* Description: markdown-rendered by default, click to edit. Empty
              state shows an "Add description" hint so the section is always
              actionable. Cmd/Ctrl+Enter commits, Escape cancels. */}
          <div className={styles.section}>
            <p className={styles.sectionTitle}>Description</p>
            {editingDescription ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <textarea
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setDraftDescription(descriptionValue);
                      setEditingDescription(false);
                    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault();
                      const next = draftDescription;
                      setDescriptionValue(next);
                      setEditingDescription(false);
                      doUpdateField({ description: next.length === 0 ? null : next });
                    }
                  }}
                  autoFocus
                  rows={Math.min(20, Math.max(6, draftDescription.split('\n').length + 1))}
                  placeholder="Write a description… markdown supported (Cmd/Ctrl+Enter to save, Esc to cancel)"
                  disabled={savingField}
                  style={{
                    background:   '#2d3748',
                    border:       '1px solid #4a5568',
                    borderRadius: 6,
                    color:        '#e2e8f0',
                    padding:      '10px 12px',
                    fontSize:     14,
                    lineHeight:   1.55,
                    fontFamily:   'inherit',
                    colorScheme:  'dark',
                    resize:       'vertical',
                  }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      const next = draftDescription;
                      setDescriptionValue(next);
                      setEditingDescription(false);
                      doUpdateField({ description: next.length === 0 ? null : next });
                    }}
                    disabled={savingField}
                    style={{
                      background:   '#3182ce',
                      color:        '#fff',
                      border:       'none',
                      borderRadius: 6,
                      padding:      '6px 14px',
                      fontSize:     13,
                      fontWeight:   500,
                      cursor:       savingField ? 'progress' : 'pointer',
                    }}
                  >
                    {savingField ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraftDescription(descriptionValue);
                      setEditingDescription(false);
                    }}
                    style={{
                      background:   'transparent',
                      color:        '#a0aec0',
                      border:       '1px solid #4a5568',
                      borderRadius: 6,
                      padding:      '6px 14px',
                      fontSize:     13,
                      cursor:       'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setDraftDescription(descriptionValue);
                  setEditingDescription(true);
                }}
                aria-label="Edit description"
                style={{
                  background: 'transparent',
                  border:     '1px dashed transparent',
                  borderRadius: 6,
                  padding:    '8px 10px',
                  margin:     '-8px -10px',
                  textAlign:  'left',
                  cursor:     'text',
                  color:      'inherit',
                  width:      '100%',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#4a5568')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'transparent')}
              >
                {descriptionValue.trim().length > 0 ? (
                  <div className={`markdown-body ${styles.description}`}>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        // Match GuideViewer's typography so descriptions feel
                        // like real markdown, not free text.
                        p:  (p) => <p style={{ margin: '0 0 0.6em' }} {...p} />,
                        ul: (p) => <ul style={{ paddingLeft: 20, margin: '0 0 0.6em' }} {...p} />,
                        ol: (p) => <ol style={{ paddingLeft: 20, margin: '0 0 0.6em' }} {...p} />,
                        a:  ({ href, ...rest }) => (
                          <a
                            href={href}
                            target={href?.startsWith('http') ? '_blank' : undefined}
                            rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
                            style={{ color: '#63b3ed', textDecoration: 'underline' }}
                            onClick={(e) => e.stopPropagation()}
                            {...rest}
                          />
                        ),
                        code: ({ children, ...rest }) => (
                          <code
                            style={{
                              background:   '#2d3748',
                              borderRadius: 4,
                              padding:      '1px 6px',
                              fontSize:     '0.9em',
                              fontFamily:   'ui-monospace, SFMono-Regular, Menlo, monospace',
                            }}
                            {...rest}
                          >
                            {children}
                          </code>
                        ),
                      }}
                    >
                      {descriptionValue}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <span style={{ color: '#718096', fontSize: 13, fontStyle: 'italic' }}>
                    Add a description…
                  </span>
                )}
              </button>
            )}
            {fieldError && (
              <p style={{ color: '#fc8181', fontSize: 12, margin: 0 }}>
                Failed to save. Please try again.
              </p>
            )}
          </div>


          <div className={styles.section}>
            <p className={styles.sectionTitle}>Attachments</p>
            <AttachmentSection taskId={taskId} />
          </div>

          <div className={styles.section}>
            <p className={styles.sectionTitle}>Time Tracking</p>
            <WorkLogSection taskId={taskId} currentUserId={currentUserId} />
          </div>

          <div className={styles.section}>
            <p className={styles.sectionTitle}>Pull Requests & Commits</p>
            <PullRequestsSection taskId={taskId} />
          </div>

          <div className={styles.section}>
            <p className={styles.sectionTitle}>Comments</p>
            <CommentSection taskId={taskId} currentUserId={currentUserId} />
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
