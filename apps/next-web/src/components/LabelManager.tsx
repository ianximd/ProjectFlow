'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useStore } from '@/store/useStore';
import type { Label } from '@projectflow/types';
import styles from './labels.module.css';

function authHeaders() {
  const token = useStore.getState().accessToken;
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function fetchLabels(projectId: string): Promise<Label[]> {
  const res = await fetch(`/api/v1/labels?projectId=${projectId}`, {
    headers: authHeaders(), credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch labels');
  return (await res.json()).labels;
}

async function createLabel(input: { projectId: string; name: string; color: string }): Promise<Label> {
  const res = await fetch('/api/v1/labels', {
    method: 'POST', headers: authHeaders(), credentials: 'include',
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Failed to create label');
  return (await res.json()).label;
}

async function updateLabel(id: string, patch: { name?: string; color?: string }): Promise<Label> {
  const res = await fetch(`/api/v1/labels/${id}`, {
    method: 'PATCH', headers: authHeaders(), credentials: 'include',
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('Failed to update label');
  return (await res.json()).label;
}

async function deleteLabel(id: string): Promise<void> {
  const res = await fetch(`/api/v1/labels/${id}`, {
    method: 'DELETE', headers: authHeaders(), credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to delete label');
}

// ── Label Swatch ─────────────────────────────────────────────────────────────

export function LabelBadge({ name, color }: { name: string; color: string }) {
  return (
    <span
      style={{
        background: color + '22',
        color,
        border: `1px solid ${color}55`,
        borderRadius: '999px',
        padding: '0.15rem 0.6rem',
        fontSize: '0.7rem',
        fontWeight: 600,
        letterSpacing: '0.03em',
        whiteSpace: 'nowrap',
      }}
    >
      {name}
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface Props { projectId: string }

const PRESET_COLORS = [
  '#6c63ff', '#f38ba8', '#a6e3a1', '#fab387',
  '#89dceb', '#f9e2af', '#b4befe', '#cba6f7',
];

export default function LabelManager({ projectId }: Props) {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', color: '#6c63ff' });

  const { data: labels = [], isLoading } = useQuery({
    queryKey: ['labels', projectId],
    queryFn:  () => fetchLabels(projectId),
    enabled:  !!projectId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['labels', projectId] });

  const createMut = useMutation({
    mutationFn: (input: { projectId: string; name: string; color: string }) => createLabel(input),
    onSuccess:  () => { invalidate(); setShowCreate(false); setForm({ name: '', color: '#6c63ff' }); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; color?: string } }) => updateLabel(id, patch),
    onSuccess:  () => { invalidate(); setEditingId(null); },
  });

  const deleteMut = useMutation({ mutationFn: deleteLabel, onSuccess: invalidate });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      updateMut.mutate({ id: editingId, patch: { name: form.name, color: form.color } });
    } else {
      createMut.mutate({ projectId, name: form.name, color: form.color });
    }
  };

  const startEdit = (l: Label) => {
    setEditingId(l.id);
    setShowCreate(false);
    setForm({ name: l.name, color: l.color });
  };

  if (isLoading) return <div className={styles.loading}>Loading labels…</div>;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>Labels</h2>
        <button className={styles.btnPrimary} onClick={() => { setShowCreate(true); setEditingId(null); setForm({ name: '', color: '#6c63ff' }); }}>
          + New Label
        </button>
      </div>

      {(showCreate || editingId) && (
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>{editingId ? 'Edit Label' : 'New Label'}</h3>
          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.row}>
              <label>Name *</label>
              <input
                className={styles.input}
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                required placeholder="e.g. bug, enhancement"
              />
            </div>
            <div className={styles.row}>
              <label>Color</label>
              <div className={styles.colorRow}>
                <input type="color" className={styles.colorInput} value={form.color} onChange={e => setForm(p => ({ ...p, color: e.target.value }))} />
                {PRESET_COLORS.map(c => (
                  <button
                    key={c} type="button"
                    className={styles.colorChip}
                    style={{ background: c, outline: form.color === c ? `2px solid #fff` : 'none' }}
                    onClick={() => setForm(p => ({ ...p, color: c }))}
                  />
                ))}
              </div>
            </div>
            <div className={styles.preview}>
              Preview: <LabelBadge name={form.name || 'label'} color={form.color} />
            </div>
            <div className={styles.formActions}>
              <button type="button" className={styles.btnSecondary} onClick={() => { setShowCreate(false); setEditingId(null); }}>Cancel</button>
              <button type="submit" className={styles.btnPrimary} disabled={createMut.isPending || updateMut.isPending}>
                {editingId ? 'Save' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}

      {labels.length === 0 ? (
        <div className={styles.empty}>No labels yet. Create labels to tag your issues.</div>
      ) : (
        <div className={styles.list}>
          {labels.map(l => (
            <div key={l.id} className={styles.labelRow}>
              <LabelBadge name={l.name} color={l.color} />
              <span className={styles.issueCount}>{l.issueCount} issue{l.issueCount !== 1 ? 's' : ''}</span>
              <div className={styles.labelActions}>
                <button className={styles.btnSecondary} onClick={() => startEdit(l)}>Edit</button>
                <button className={styles.btnDanger} onClick={() => { if (confirm(`Delete label "${l.name}"?`)) deleteMut.mutate(l.id); }}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
