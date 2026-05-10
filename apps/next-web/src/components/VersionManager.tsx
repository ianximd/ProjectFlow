'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useStore } from '@/store/useStore';
import type { Version, CreateVersionInput, VersionStatus } from '@projectflow/types';
import styles from './versions.module.css';

// ── API helpers ──────────────────────────────────────────────────────────────

function authHeaders() {
  const token = useStore.getState().accessToken;
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function fetchVersions(projectId: string): Promise<Version[]> {
  const res = await fetch(`/api/v1/versions?projectId=${projectId}`, {
    headers: authHeaders(), credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch versions');
  const data = await res.json();
  return data.versions;
}

async function createVersion(input: CreateVersionInput): Promise<Version> {
  const res = await fetch('/api/v1/versions', {
    method: 'POST', headers: authHeaders(), credentials: 'include',
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Failed to create version');
  const data = await res.json();
  return data.version;
}

async function updateVersion(id: string, patch: Record<string, unknown>): Promise<Version> {
  const res = await fetch(`/api/v1/versions/${id}`, {
    method: 'PATCH', headers: authHeaders(), credentials: 'include',
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('Failed to update version');
  const data = await res.json();
  return data.version;
}

async function releaseVersion(id: string): Promise<Version> {
  const res = await fetch(`/api/v1/versions/${id}/release`, {
    method: 'POST', headers: authHeaders(), credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to release version');
  return (await res.json()).version;
}

async function archiveVersion(id: string): Promise<Version> {
  const res = await fetch(`/api/v1/versions/${id}/archive`, {
    method: 'POST', headers: authHeaders(), credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to archive version');
  return (await res.json()).version;
}

async function deleteVersion(id: string): Promise<void> {
  const res = await fetch(`/api/v1/versions/${id}`, {
    method: 'DELETE', headers: authHeaders(), credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to delete version');
}

// ── Sub-components ───────────────────────────────────────────────────────────

const STATUS_COLORS: Record<VersionStatus, string> = {
  UNRELEASED: '#6c63ff',
  RELEASED:   '#27c93f',
  ARCHIVED:   '#888',
};

function StatusBadge({ status }: { status: VersionStatus }) {
  return (
    <span className={styles.badge} style={{ background: STATUS_COLORS[status] + '22', color: STATUS_COLORS[status], borderColor: STATUS_COLORS[status] + '55' }}>
      {status}
    </span>
  );
}

function ProgressBar({ total, done }: { total: number; done: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className={styles.progressBar}>
      <div className={styles.progressFill} style={{ width: `${pct}%` }} />
      <span className={styles.progressLabel}>{done}/{total} issues ({pct}%)</span>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

interface Props { projectId: string }

export default function VersionManager({ projectId }: Props) {
  const qc = useQueryClient();
  const [showCreate, setShowCreate]  = useState(false);
  const [editingId,  setEditingId]   = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', startDate: '', releaseDate: '' });

  const { data: versions = [], isLoading } = useQuery({
    queryKey: ['versions', projectId],
    queryFn:  () => fetchVersions(projectId),
    enabled:  !!projectId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['versions', projectId] });

  const createMut = useMutation({
    mutationFn: (input: CreateVersionInput) => createVersion(input),
    onSuccess: () => { invalidate(); setShowCreate(false); setForm({ name: '', description: '', startDate: '', releaseDate: '' }); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => updateVersion(id, patch),
    onSuccess: () => { invalidate(); setEditingId(null); },
  });

  const releaseMut  = useMutation({ mutationFn: releaseVersion,  onSuccess: invalidate });
  const archiveMut  = useMutation({ mutationFn: archiveVersion,  onSuccess: invalidate });
  const deleteMut   = useMutation({ mutationFn: deleteVersion,   onSuccess: invalidate });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMut.mutate({
      projectId,
      name:        form.name,
      description: form.description || undefined,
      startDate:   form.startDate   || undefined,
      releaseDate: form.releaseDate || undefined,
    });
  };

  const startEdit = (v: Version) => {
    setEditingId(v.id);
    setForm({
      name:        v.name,
      description: v.description ?? '',
      startDate:   v.startDate   ?? '',
      releaseDate: v.releaseDate ?? '',
    });
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    updateMut.mutate({
      id: editingId,
      patch: {
        name:        form.name        || undefined,
        description: form.description || undefined,
        startDate:   form.startDate   || undefined,
        releaseDate: form.releaseDate || undefined,
      },
    });
  };

  if (isLoading) return <div className={styles.loading}>Loading versions…</div>;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>Versions / Releases</h2>
        <button className={styles.btnPrimary} onClick={() => { setShowCreate(true); setEditingId(null); }}>
          + New Version
        </button>
      </div>

      {/* Create / Edit Form */}
      {(showCreate || editingId) && (
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>{editingId ? 'Edit Version' : 'Create Version'}</h3>
          <form onSubmit={editingId ? handleUpdate : handleCreate} className={styles.form}>
            <div className={styles.row}>
              <label>Name *</label>
              <input
                className={styles.input}
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                required
                placeholder="e.g. v1.0.0"
              />
            </div>
            <div className={styles.row}>
              <label>Description</label>
              <textarea
                className={styles.input}
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                rows={2}
                placeholder="Release notes…"
              />
            </div>
            <div className={styles.row2col}>
              <div className={styles.row}>
                <label>Start Date</label>
                <input type="date" className={styles.input} value={form.startDate} onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))} />
              </div>
              <div className={styles.row}>
                <label>Release Date</label>
                <input type="date" className={styles.input} value={form.releaseDate} onChange={e => setForm(p => ({ ...p, releaseDate: e.target.value }))} />
              </div>
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

      {/* Version List */}
      {versions.length === 0 ? (
        <div className={styles.empty}>No versions yet. Create one to track releases.</div>
      ) : (
        <div className={styles.list}>
          {versions.map(v => (
            <div key={v.id} className={styles.versionCard}>
              <div className={styles.versionHeader}>
                <div className={styles.versionLeft}>
                  <StatusBadge status={v.status as VersionStatus} />
                  <span className={styles.versionName}>{v.name}</span>
                  {v.releaseDate && (
                    <span className={styles.versionDate}>Due: {v.releaseDate}</span>
                  )}
                </div>
                <div className={styles.versionActions}>
                  {v.status === 'UNRELEASED' && (
                    <button className={styles.btnRelease} onClick={() => releaseMut.mutate(v.id)} disabled={releaseMut.isPending}>
                      Release
                    </button>
                  )}
                  {v.status !== 'ARCHIVED' && (
                    <button className={styles.btnSecondary} onClick={() => archiveMut.mutate(v.id)} disabled={archiveMut.isPending}>
                      Archive
                    </button>
                  )}
                  <button className={styles.btnSecondary} onClick={() => startEdit(v)}>Edit</button>
                  <button className={styles.btnDanger} onClick={() => { if (confirm(`Delete version "${v.name}"?`)) deleteMut.mutate(v.id); }}>
                    Delete
                  </button>
                </div>
              </div>
              {v.description && <p className={styles.versionDesc}>{v.description}</p>}
              <ProgressBar total={v.totalIssues} done={v.completedIssues} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
