'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useStore } from '@/store/useStore';
import styles from './SearchModal.module.css';

interface SearchTask {
  id: string;
  issueKey: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  projectName: string;
  projectKey: string;
}

interface Props {
  workspaceId?: string;
  onSelectTask?: (task: SearchTask) => void;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

async function apiFetch(path: string) {
  const token = useStore.getState().accessToken;
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'include',
  });
  return res.json();
}

export function SearchModal({ workspaceId, onSelectTask }: Props) {
  const [open,     setOpen]     = useState(false);
  const [query,    setQuery]    = useState('');
  const [focused,  setFocused]  = useState(0);
  const inputRef                = useRef<HTMLInputElement>(null);
  const debouncedQuery          = useDebounce(query.trim(), 280);

  // Global Cmd/Ctrl+K shortcut
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setFocused(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const searchUrl = workspaceId && debouncedQuery
    ? `/api/v1/search?workspaceId=${encodeURIComponent(workspaceId)}&q=${encodeURIComponent(debouncedQuery)}&pageSize=15`
    : null;

  const { data, isFetching } = useQuery<{ data: SearchTask[] }>({
    queryKey: ['search', debouncedQuery, workspaceId],
    queryFn:  () => apiFetch(searchUrl!),
    enabled:  !!searchUrl,
    staleTime: 10_000,
  });

  const results = data?.data ?? [];

  // Keyboard navigation inside list
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocused((f) => Math.min(f + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocused((f) => Math.max(f - 1, 0));
      } else if (e.key === 'Enter' && results[focused]) {
        handleSelect(results[focused]);
      }
    },
    [results, focused],
  );

  function handleSelect(task: SearchTask) {
    onSelectTask?.(task);
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={() => setOpen(false)}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Input */}
        <div className={styles.inputRow}>
          <svg className={styles.searchIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            className={styles.input}
            placeholder="Search issues by title, key, or use PQL…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setFocused(0); }}
            onKeyDown={onKeyDown}
          />
          <span className={styles.kbd}>Esc</span>
        </div>

        {/* Results */}
        <div className={styles.results}>
          {!debouncedQuery && (
            <p className={styles.empty}>Type to search across all issues.</p>
          )}
          {debouncedQuery && isFetching && (
            <p className={styles.loading}>Searching…</p>
          )}
          {debouncedQuery && !isFetching && results.length === 0 && (
            <p className={styles.empty}>No issues found for "{debouncedQuery}".</p>
          )}
          {results.length > 0 && (
            <div className={styles.group}>
              <p className={styles.groupLabel}>Issues</p>
              {results.map((task, i) => (
                <div
                  key={task.id}
                  className={`${styles.item}${i === focused ? ` ${styles.focused}` : ''}`}
                  onMouseEnter={() => setFocused(i)}
                  onClick={() => handleSelect(task)}
                >
                  <span className={styles.issueKey}>{task.issueKey}</span>
                  <span className={styles.titleText}>{task.title}</span>
                  <div className={styles.badges}>
                    <span className={styles.badge + ' ' + styles.badgeStatus}>
                      {task.status}
                    </span>
                    <span className={`${styles.badge} ${styles.badgePriority} ${task.priority}`}>
                      {task.priority}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Hint bar */}
        <div className={styles.hint}>
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>Esc close</span>
          <span style={{ marginLeft: 'auto' }}>
            Supports PQL: <code>type = BUG AND priority = HIGH</code>
          </span>
        </div>
      </div>
    </div>
  );
}
