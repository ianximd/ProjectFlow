'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { notifyActionError } from '@/lib/apiErrorToast';
import {
  loadTaskDependencies,
  addTaskDependency,
  removeTaskDependency,
  searchTasksForDependency,
  type DependencyCandidate,
} from '@/server/actions/dependencies';
import type {
  DependencyRelation,
  TaskDependencyLists,
  TaskDependencyRef,
} from '@projectflow/types';

const STATUS_COLOR = '#a0aec0';

/**
 * Dependencies section for the task drawer. Two labelled lists — "Waiting on"
 * (this task's blockers) and "Blocking" (tasks this one blocks). Each row links
 * a task (issueKey + title + status) with a remove (×) control; an "Add"
 * affordance opens an inline task-search picker that links the chosen task with
 * the right relation.
 *
 * Loads via a client-callable server action (mirrors WatcherControl), mutates
 * via POST/DELETE server actions, and refetches the lists after each mutate.
 * Curated CIRCULAR_DEPENDENCY / INVALID_DEPENDENCY errors surface as toasts.
 */
export function DependenciesSection({
  taskId,
  workspaceId,
}: {
  taskId: string;
  workspaceId: string | null;
}) {
  const t = useTranslations('Dependencies');
  const [lists, setLists] = useState<TaskDependencyLists>({ waitingOn: [], blocking: [] });
  const [openPicker, setOpenPicker] = useState<DependencyRelation | null>(null);
  const [, start] = useTransition();

  const refresh = useCallback(async () => {
    const next = await loadTaskDependencies(taskId);
    setLists(next);
  }, [taskId]);

  useEffect(() => {
    let cancelled = false;
    loadTaskDependencies(taskId)
      .then((next) => { if (!cancelled) setLists(next); })
      .catch(() => { /* leave empty */ });
    return () => { cancelled = true; };
  }, [taskId]);

  function add(dependsOnId: string, relation: DependencyRelation) {
    setOpenPicker(null);
    start(async () => {
      const r = await addTaskDependency(taskId, dependsOnId, relation);
      if (!r.ok) {
        // Curated, translated messages for the well-known validation codes.
        if (r.code === 'CIRCULAR_DEPENDENCY') {
          notifyActionError({ error: t('circularError'), status: r.status });
        } else if (r.code === 'INVALID_DEPENDENCY') {
          notifyActionError({ error: t('invalidError'), status: r.status });
        } else {
          notifyActionError({ error: r.error || t('addFailed'), code: r.code, status: r.status });
        }
        return;
      }
      await refresh();
    });
  }

  function remove(otherId: string, relation: DependencyRelation) {
    // Optimistic removal — drop the row, then refetch the authoritative set.
    setLists((prev) => ({
      waitingOn: relation === 'waiting_on' ? prev.waitingOn.filter((x) => x.taskId !== otherId) : prev.waitingOn,
      blocking:  relation === 'blocking'  ? prev.blocking.filter((x) => x.taskId !== otherId)  : prev.blocking,
    }));
    start(async () => {
      const r = await removeTaskDependency(taskId, otherId, relation);
      if (!r.ok) {
        notifyActionError({ error: r.error || t('removeFailed'), code: r.code, status: r.status });
      }
      await refresh();
    });
  }

  // Exclude already-linked tasks (and the task itself) from picker results.
  const linkedIds = new Set<string>([
    taskId.toUpperCase(),
    ...lists.waitingOn.map((x) => x.taskId.toUpperCase()),
    ...lists.blocking.map((x) => x.taskId.toUpperCase()),
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <DependencyList
        label={t('waitingOn')}
        emptyLabel={t('waitingOnEmpty')}
        addLabel={t('addWaitingOn')}
        removeLabel={(title) => t('removeWaitingOn', { title })}
        refs={lists.waitingOn}
        relation="waiting_on"
        pickerOpen={openPicker === 'waiting_on'}
        onTogglePicker={() => setOpenPicker((p) => (p === 'waiting_on' ? null : 'waiting_on'))}
        onClosePicker={() => setOpenPicker(null)}
        onRemove={(otherId) => remove(otherId, 'waiting_on')}
        onPick={(id) => add(id, 'waiting_on')}
        workspaceId={workspaceId}
        excludeIds={linkedIds}
      />
      <DependencyList
        label={t('blocking')}
        emptyLabel={t('blockingEmpty')}
        addLabel={t('addBlocking')}
        removeLabel={(title) => t('removeBlocking', { title })}
        refs={lists.blocking}
        relation="blocking"
        pickerOpen={openPicker === 'blocking'}
        onTogglePicker={() => setOpenPicker((p) => (p === 'blocking' ? null : 'blocking'))}
        onClosePicker={() => setOpenPicker(null)}
        onRemove={(otherId) => remove(otherId, 'blocking')}
        onPick={(id) => add(id, 'blocking')}
        workspaceId={workspaceId}
        excludeIds={linkedIds}
      />
    </div>
  );
}

function DependencyList({
  label,
  emptyLabel,
  addLabel,
  removeLabel,
  refs,
  pickerOpen,
  onTogglePicker,
  onClosePicker,
  onRemove,
  onPick,
  workspaceId,
  excludeIds,
}: {
  label: string;
  emptyLabel: string;
  addLabel: string;
  removeLabel: (title: string) => string;
  refs: TaskDependencyRef[];
  relation: DependencyRelation;
  pickerOpen: boolean;
  onTogglePicker: () => void;
  onClosePicker: () => void;
  onRemove: (otherId: string) => void;
  onPick: (id: string) => void;
  workspaceId: string | null;
  excludeIds: Set<string>;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, color: '#718096', fontWeight: 600 }}>{label}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, position: 'relative' }}>
        {refs.length === 0 && (
          <span style={{ fontSize: 13, color: '#718096' }}>{emptyLabel}</span>
        )}
        {refs.map((r) => (
          <DependencyRow key={r.taskId} dep={r} removeLabel={removeLabel(r.title)} onRemove={() => onRemove(r.taskId)} />
        ))}
        <div>
          <button
            type="button"
            onClick={onTogglePicker}
            disabled={!workspaceId}
            style={{
              background:   'transparent',
              border:       '1px dashed #4a5568',
              borderRadius: 6,
              padding:      '3px 10px',
              fontSize:     12,
              color:        '#a0aec0',
              cursor:       workspaceId ? 'pointer' : 'default',
            }}
          >
            {addLabel}
          </button>
        </div>
        {pickerOpen && workspaceId && (
          <TaskPicker
            workspaceId={workspaceId}
            excludeIds={excludeIds}
            onPick={onPick}
            onClose={onClosePicker}
          />
        )}
      </div>
    </div>
  );
}

function DependencyRow({
  dep,
  removeLabel,
  onRemove,
}: {
  dep: TaskDependencyRef;
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        display:      'flex',
        alignItems:   'center',
        gap:          8,
        background:   '#2d3748',
        border:       '1px solid #4a5568',
        borderRadius: 6,
        padding:      '4px 8px',
        fontSize:     12,
        color:        '#e2e8f0',
      }}
    >
      {dep.issueKey && (
        <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#63b3ed' }}>
          {dep.issueKey}
        </span>
      )}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {dep.title}
      </span>
      {dep.status && <span style={{ fontSize: 11, color: STATUS_COLOR }}>{dep.status}</span>}
      <button
        type="button"
        aria-label={removeLabel}
        title={removeLabel}
        onClick={onRemove}
        style={{
          background: 'transparent',
          color:      '#a0aec0',
          border:     'none',
          cursor:     'pointer',
          padding:    '0 2px',
          lineHeight: 1,
          fontSize:   16,
        }}
      >
        ×
      </button>
    </div>
  );
}

/** Inline debounced search-by-title picker, styled to match the assignee picker. */
function TaskPicker({
  workspaceId,
  excludeIds,
  onPick,
  onClose,
}: {
  workspaceId: string;
  excludeIds: Set<string>;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('Dependencies');
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DependencyCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Close on outside click.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Debounced search.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults(null); setLoading(false); return; }
    setLoading(true);
    let cancelled = false;
    const handle = setTimeout(() => {
      searchTasksForDependency(workspaceId, q)
        .then((rows) => { if (!cancelled) { setResults(rows); setLoading(false); } })
        .catch(() => { if (!cancelled) { setResults([]); setLoading(false); } });
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [query, workspaceId]);

  const filtered = (results ?? []).filter((r) => !excludeIds.has(r.id.toUpperCase()));

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t('pickerTitle')}
      style={{
        position:     'absolute',
        top:          '100%',
        left:         0,
        marginTop:    4,
        width:        320,
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
        placeholder={t('searchPlaceholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
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
      {loading && (
        <p style={{ fontSize: 12, color: '#a0aec0', margin: '4px 6px' }}>{t('searching')}</p>
      )}
      {!loading && results === null && (
        <p style={{ fontSize: 12, color: '#a0aec0', margin: '4px 6px' }}>{t('typeToSearch')}</p>
      )}
      {!loading && results !== null && filtered.length === 0 && (
        <p style={{ fontSize: 12, color: '#a0aec0', margin: '4px 6px' }}>{t('noResults')}</p>
      )}
      {!loading && filtered.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onPick(r.id)}
          style={{
            display:      'flex',
            alignItems:   'center',
            gap:          8,
            width:        '100%',
            background:   'transparent',
            border:       'none',
            color:        '#e2e8f0',
            padding:      '6px 4px',
            borderRadius: 4,
            cursor:       'pointer',
            textAlign:    'left',
            fontSize:     12,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#2d3748')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          {r.issueKey && (
            <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#63b3ed' }}>
              {r.issueKey}
            </span>
          )}
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.title}
          </span>
          {r.status && <span style={{ fontSize: 11, color: STATUS_COLOR }}>{r.status}</span>}
        </button>
      ))}
    </div>
  );
}
