'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useStore } from '@/store/useStore';
import styles from './WorkflowEditor.module.css';

interface WorkflowStatus {
  id: string;
  name: string;
  category: string;
  color: string;
  position: number;
}

interface WorkflowTransition {
  id: string;
  fromStatus: string;
  toStatus: string;
  name: string | null;
}

interface WorkflowData {
  id: string;
  name: string;
  statuses: WorkflowStatus[];
  transitions: WorkflowTransition[];
}

interface Props {
  projectId: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  TODO:        'To Do',
  IN_PROGRESS: 'In Progress',
  DONE:        'Done',
};

const TEMPLATES = [
  { value: 'DEFAULT', label: 'Default (To Do → In Progress → Done)' },
  { value: 'BUG',     label: 'Bug Workflow' },
  { value: 'AGILE',   label: 'Agile (with Review & Testing)' },
];

async function apiFetch(path: string, init?: RequestInit) {
  const token = useStore.getState().accessToken;
  const res   = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'Request failed');
  return json;
}

export function WorkflowEditor({ projectId }: Props) {
  const qc = useQueryClient();

  // ─── Fetch ───────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery<WorkflowData | null>({
    queryKey: ['workflow', projectId],
    queryFn:  async () => {
      const json = await apiFetch(`/api/v1/workflows?projectId=${projectId}`);
      return json.data;
    },
  });

  // ─── Create workflow ──────────────────────────────────────────────────────
  const [newWfName, setNewWfName]         = useState('Default Workflow');
  const [newWfTemplate, setNewWfTemplate] = useState('DEFAULT');

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch('/api/v1/workflows', {
        method: 'POST',
        body: JSON.stringify({ projectId, name: newWfName, template: newWfTemplate }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflow', projectId] }),
  });

  // ─── Add status ───────────────────────────────────────────────────────────
  const [newStatusName, setNewStatusName]       = useState('');
  const [newStatusCategory, setNewStatusCategory] = useState('TODO');
  const [newStatusColor, setNewStatusColor]     = useState('#6b7280');

  const addStatusMutation = useMutation({
    mutationFn: (wfId: string) =>
      apiFetch(`/api/v1/workflows/${wfId}/statuses`, {
        method: 'POST',
        body: JSON.stringify({ name: newStatusName, category: newStatusCategory, color: newStatusColor }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflow', projectId] });
      setNewStatusName('');
    },
  });

  // ─── Edit status inline ───────────────────────────────────────────────────
  const [editingStatusId, setEditingStatusId]   = useState<string | null>(null);
  const [editingStatusName, setEditingStatusName] = useState('');

  const updateStatusMutation = useMutation({
    mutationFn: ({ statusId, name }: { statusId: string; name: string }) =>
      apiFetch(`/api/v1/workflows/statuses/${statusId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflow', projectId] });
      setEditingStatusId(null);
    },
  });

  // ─── Delete status ────────────────────────────────────────────────────────
  const deleteStatusMutation = useMutation({
    mutationFn: (statusId: string) =>
      apiFetch(`/api/v1/workflows/statuses/${statusId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflow', projectId] }),
    onError:   (err: any) => alert(err.message),
  });

  // ─── Add transition ───────────────────────────────────────────────────────
  const [txFrom, setTxFrom] = useState('');
  const [txTo,   setTxTo]   = useState('');

  const addTransitionMutation = useMutation({
    mutationFn: (wfId: string) =>
      apiFetch(`/api/v1/workflows/${wfId}/transitions`, {
        method: 'POST',
        body: JSON.stringify({ fromStatus: txFrom, toStatus: txTo }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflow', projectId] });
      setTxFrom('');
      setTxTo('');
    },
    onError: (err: any) => alert(err.message),
  });

  // ─── Remove transition ────────────────────────────────────────────────────
  const removeTransitionMutation = useMutation({
    mutationFn: ({ wfId, from, to }: { wfId: string; from: string; to: string }) =>
      apiFetch(`/api/v1/workflows/${wfId}/transitions`, {
        method: 'DELETE',
        body: JSON.stringify({ fromStatus: from, toStatus: to }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflow', projectId] }),
  });

  // ─── Render ───────────────────────────────────────────────────────────────

  if (isLoading) return <p style={{ color: 'var(--color-text-secondary)' }}>Loading workflow…</p>;

  if (!data) {
    return (
      <div className={styles.createPanel}>
        <h3 className={styles.createTitle}>No workflow yet</h3>
        <p className={styles.createSub}>
          Create a workflow to define statuses and allowed transitions for this project.
        </p>
        <div className={styles.createForm}>
          <input
            className={styles.addFormInput}
            placeholder="Workflow name"
            value={newWfName}
            onChange={e => setNewWfName(e.target.value)}
          />
          <select
            className={styles.addFormSelect}
            value={newWfTemplate}
            onChange={e => setNewWfTemplate(e.target.value)}
          >
            {TEMPLATES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <button
            className={styles.addBtn}
            disabled={!newWfName.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            Create Workflow
          </button>
        </div>
      </div>
    );
  }

  const statusNames = data.statuses.map(s => s.name);

  return (
    <div className={styles.editor}>
      {/* ── Statuses ── */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>Statuses ({data.statuses.length})</h3>
        </div>

        <div className={styles.statusGrid}>
          {data.statuses.map(status => (
            <div
              key={status.id}
              className={styles.statusNode}
              style={{ borderColor: status.color + '55' }}
            >
              <span className={styles.statusDot} style={{ background: status.color }} />

              {editingStatusId === status.id ? (
                <input
                  className={styles.inlineEdit}
                  value={editingStatusName}
                  autoFocus
                  onChange={e => setEditingStatusName(e.target.value)}
                  onBlur={() => {
                    if (editingStatusName.trim() && editingStatusName !== status.name) {
                      updateStatusMutation.mutate({ statusId: status.id, name: editingStatusName.trim() });
                    } else {
                      setEditingStatusId(null);
                    }
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setEditingStatusId(null);
                  }}
                />
              ) : (
                <span className={styles.statusName}>{status.name}</span>
              )}

              <span className={styles.categoryBadge}>
                {CATEGORY_LABELS[status.category] ?? status.category}
              </span>

              <div className={styles.statusActions}>
                <button
                  className={styles.iconBtn}
                  title="Rename"
                  onClick={() => { setEditingStatusId(status.id); setEditingStatusName(status.name); }}
                >✎</button>
                <button
                  className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                  title="Delete"
                  onClick={() => {
                    if (confirm(`Delete status "${status.name}"?`)) {
                      deleteStatusMutation.mutate(status.id);
                    }
                  }}
                >✕</button>
              </div>
            </div>
          ))}
        </div>

        {/* Add status form */}
        <div className={styles.addForm}>
          <input
            className={styles.addFormInput}
            placeholder="Status name"
            value={newStatusName}
            onChange={e => setNewStatusName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && newStatusName.trim() && addStatusMutation.mutate(data.id)}
          />
          <select
            className={styles.addFormSelect}
            value={newStatusCategory}
            onChange={e => setNewStatusCategory(e.target.value)}
          >
            <option value="TODO">To Do</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="DONE">Done</option>
          </select>
          <input
            type="color"
            className={styles.colorInput}
            value={newStatusColor}
            onChange={e => setNewStatusColor(e.target.value)}
            title="Status color"
          />
          <button
            className={styles.addBtn}
            disabled={!newStatusName.trim() || addStatusMutation.isPending}
            onClick={() => addStatusMutation.mutate(data.id)}
          >
            + Add Status
          </button>
        </div>
      </div>

      {/* ── Transitions ── */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>Transitions ({data.transitions.length})</h3>
        </div>

        <div className={styles.transitionList}>
          {data.transitions.length === 0 && (
            <p className={styles.emptyTrans}>No transitions defined. Add one below.</p>
          )}
          {data.transitions.map(t => (
            <div key={t.id} className={styles.transitionRow}>
              <span className={styles.transitionFrom}>{t.fromStatus}</span>
              <span className={styles.transitionArrow}>→</span>
              <span className={styles.transitionTo}>{t.toStatus}</span>
              {t.name && <span className={styles.transitionName}>({t.name})</span>}
              <button
                className={`${styles.iconBtn} ${styles.iconBtnDanger} ${styles.transitionDeleteBtn}`}
                title="Remove transition"
                onClick={() =>
                  removeTransitionMutation.mutate({ wfId: data.id, from: t.fromStatus, to: t.toStatus })
                }
              >✕</button>
            </div>
          ))}
        </div>

        {/* Add transition form */}
        <div className={styles.addForm}>
          <select
            className={styles.addFormSelect}
            value={txFrom}
            onChange={e => setTxFrom(e.target.value)}
          >
            <option value="">From status…</option>
            {statusNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span style={{ color: 'var(--color-accent)', fontWeight: 700 }}>→</span>
          <select
            className={styles.addFormSelect}
            value={txTo}
            onChange={e => setTxTo(e.target.value)}
          >
            <option value="">To status…</option>
            {statusNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button
            className={styles.addBtn}
            disabled={!txFrom || !txTo || txFrom === txTo || addTransitionMutation.isPending}
            onClick={() => addTransitionMutation.mutate(data.id)}
          >
            + Add Transition
          </button>
        </div>
      </div>
    </div>
  );
}
