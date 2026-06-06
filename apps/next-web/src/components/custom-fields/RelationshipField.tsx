'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { notifyActionError } from '@/lib/apiErrorToast';
import {
  loadTaskRelationships,
  addTaskRelationship,
  removeTaskRelationship,
  searchTasksForRelationship,
  type RelationshipCandidate,
} from '@/server/actions/relationships';
import type { RelationshipRef } from '@projectflow/types';

const STATUS_COLOR = '#a0aec0';

/**
 * Link/unlink picker for a `relationship`-type custom field, rendered as the
 * value editor inside the task drawer. Shows the linked tasks as chips
 * (issueKey + title + status) with a remove (×) control; an "Add" affordance
 * opens an inline debounced task-search picker (reuses `GET /search`) that links
 * the chosen task.
 *
 * Mirrors `DependenciesSection` + the assignee picker exactly: client-callable
 * loader, POST/DELETE server actions, optimistic remove, refetch after mutate.
 * Relationship values are NOT written through the generic custom-field value
 * endpoint (the API rejects that) — they go through the dedicated relationship
 * routes.
 */
export function RelationshipField({
  taskId,
  fieldId,
  workspaceId,
  disabled,
}: {
  taskId: string;
  fieldId: string;
  workspaceId: string | null;
  disabled?: boolean;
}) {
  const t = useTranslations('Relationships');
  const [refs, setRefs] = useState<RelationshipRef[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [, start] = useTransition();

  const refresh = useCallback(async () => {
    const next = await loadTaskRelationships(taskId, fieldId);
    setRefs(next);
  }, [taskId, fieldId]);

  useEffect(() => {
    let cancelled = false;
    loadTaskRelationships(taskId, fieldId)
      .then((next) => { if (!cancelled) setRefs(next); })
      .catch(() => { /* leave empty */ });
    return () => { cancelled = true; };
  }, [taskId, fieldId]);

  function add(toTaskId: string) {
    setPickerOpen(false);
    start(async () => {
      const r = await addTaskRelationship(taskId, fieldId, toTaskId);
      if (!r.ok) {
        if (r.code === 'INVALID_RELATIONSHIP') {
          notifyActionError({ error: t('invalidError'), status: r.status });
        } else {
          notifyActionError({ error: r.error || t('addFailed'), code: r.code, status: r.status });
        }
        return;
      }
      await refresh();
    });
  }

  function remove(toTaskId: string) {
    // Optimistic removal — drop the chip, then refetch the authoritative set.
    setRefs((prev) => prev.filter((x) => x.taskId !== toTaskId));
    start(async () => {
      const r = await removeTaskRelationship(taskId, fieldId, toTaskId);
      if (!r.ok) {
        notifyActionError({ error: r.error || t('removeFailed'), code: r.code, status: r.status });
      }
      await refresh();
    });
  }

  // Exclude already-linked tasks (and the task itself) from picker results.
  const linkedIds = new Set<string>([
    taskId.toUpperCase(),
    ...refs.map((x) => x.taskId.toUpperCase()),
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, position: 'relative' }}>
      {refs.length === 0 && (
        <span style={{ fontSize: 13, color: '#718096' }}>{t('empty')}</span>
      )}
      {refs.map((r) => (
        <RelationshipRow
          key={r.taskId}
          ref_={r}
          removeLabel={t('remove', { title: r.title })}
          onRemove={() => remove(r.taskId)}
          disabled={disabled || !workspaceId}
        />
      ))}
      <div>
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          disabled={disabled || !workspaceId}
          style={{
            background:   'transparent',
            border:       '1px dashed #4a5568',
            borderRadius: 6,
            padding:      '3px 10px',
            fontSize:     12,
            color:        '#a0aec0',
            cursor:       (disabled || !workspaceId) ? 'default' : 'pointer',
          }}
        >
          {t('add')}
        </button>
      </div>
      {pickerOpen && workspaceId && (
        <TaskPicker
          workspaceId={workspaceId}
          excludeIds={linkedIds}
          onPick={add}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

function RelationshipRow({
  ref_,
  removeLabel,
  onRemove,
  disabled,
}: {
  ref_: RelationshipRef;
  removeLabel: string;
  onRemove: () => void;
  disabled?: boolean;
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
      {ref_.issueKey && (
        <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#63b3ed' }}>
          {ref_.issueKey}
        </span>
      )}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {ref_.title}
      </span>
      {ref_.status && <span style={{ fontSize: 11, color: STATUS_COLOR }}>{ref_.status}</span>}
      <button
        type="button"
        aria-label={removeLabel}
        title={removeLabel}
        onClick={onRemove}
        disabled={disabled}
        style={{
          background: 'transparent',
          color:      '#a0aec0',
          border:     'none',
          cursor:     disabled ? 'default' : 'pointer',
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

/** Inline debounced search-by-title picker, styled to match the dependency/assignee picker. */
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
  const t = useTranslations('Relationships');
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RelationshipCandidate[] | null>(null);
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
      searchTasksForRelationship(workspaceId, q)
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
