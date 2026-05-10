'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useStore } from '@/store/useStore';
import type { ProjectComponent } from '@projectflow/types';
import styles from './components.module.css';

function authHeaders() {
  const token = useStore.getState().accessToken;
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function fetchComponents(projectId: string): Promise<ProjectComponent[]> {
  const res = await fetch(`/api/v1/components?projectId=${projectId}`, {
    headers: authHeaders(), credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch components');
  return (await res.json()).components;
}

async function createComponent(input: { projectId: string; name: string; description: string; leadUserId: string }): Promise<ProjectComponent> {
  const res = await fetch('/api/v1/components', {
    method: 'POST', headers: authHeaders(), credentials: 'include',
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Failed to create component');
  return (await res.json()).component;
}

async function updateComponent(id: string, patch: Record<string, unknown>): Promise<ProjectComponent> {
  const res = await fetch(`/api/v1/components/${id}`, {
    method: 'PATCH', headers: authHeaders(), credentials: 'include',
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('Failed to update component');
  return (await res.json()).component;
}

async function deleteComponent(id: string): Promise<void> {
  const res = await fetch(`/api/v1/components/${id}`, {
    method: 'DELETE', headers: authHeaders(), credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to delete component');
}

// ── Main Component ────────────────────────────────────────────────────────────

interface Props { projectId: string }

export default function ComponentManager({ projectId }: Props) {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '' });

  const { data: components = [], isLoading } = useQuery({
    queryKey: ['components', projectId],
    queryFn:  () => fetchComponents(projectId),
    enabled:  !!projectId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['components', projectId] });

  const createMut = useMutation({
    mutationFn: (input: { projectId: string; name: string; description: string; leadUserId: string }) => createComponent(input),
    onSuccess:  () => { invalidate(); setShowCreate(false); setForm({ name: '', description: '' }); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => updateComponent(id, patch),
    onSuccess:  () => { invalidate(); setEditingId(null); },
  });

  const deleteMut = useMutation({ mutationFn: deleteComponent, onSuccess: invalidate });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      updateMut.mutate({ id: editingId, patch: { name: form.name, description: form.description || undefined } });
    } else {
      createMut.mutate({ projectId, name: form.name, description: form.description, leadUserId: '' });
    }
  };

  const startEdit = (c: ProjectComponent) => {
    setEditingId(c.id);
    setShowCreate(false);
    setForm({ name: c.name, description: c.description ?? '' });
  };

  if (isLoading) return <div className={styles.loading}>Loading components…</div>;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>Components</h2>
        <button className={styles.btnPrimary} onClick={() => { setShowCreate(true); setEditingId(null); setForm({ name: '', description: '' }); }}>
          + New Component
        </button>
      </div>

      {(showCreate || editingId) && (
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>{editingId ? 'Edit Component' : 'New Component'}</h3>
          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.row}>
              <label>Name *</label>
              <input
                className={styles.input}
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                required placeholder="e.g. Frontend, Auth, Database"
              />
            </div>
            <div className={styles.row}>
              <label>Description</label>
              <textarea
                className={styles.input}
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                rows={2}
                placeholder="Describe this component…"
              />
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

      {components.length === 0 ? (
        <div className={styles.empty}>No components yet. Components help you categorize issues.</div>
      ) : (
        <div className={styles.list}>
          {components.map(comp => (
            <div key={comp.id} className={styles.compCard}>
              <div className={styles.compHeader}>
                <div className={styles.compLeft}>
                  <span className={styles.compIcon}>⬡</span>
                  <div>
                    <div className={styles.compName}>{comp.name}</div>
                    {comp.description && <div className={styles.compDesc}>{comp.description}</div>}
                  </div>
                </div>
                <div className={styles.compRight}>
                  {comp.leadUserName && (
                    <span className={styles.lead}>Lead: {comp.leadUserName}</span>
                  )}
                  <span className={styles.issueCount}>{comp.issueCount} issue{comp.issueCount !== 1 ? 's' : ''}</span>
                  <button className={styles.btnSecondary} onClick={() => startEdit(comp)}>Edit</button>
                  <button className={styles.btnDanger} onClick={() => { if (confirm(`Delete component "${comp.name}"?`)) deleteMut.mutate(comp.id); }}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
