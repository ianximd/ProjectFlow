'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useStore } from '@/store/useStore';
import type { GitConnection, GitProvider } from '@projectflow/types';
import styles from './git-integration.module.css';

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function fetchConnections(workspaceId: string, token: string): Promise<GitConnection[]> {
  const res = await fetch(`/api/v1/git/connections?workspaceId=${workspaceId}`, {
    headers: authHeaders(token), credentials: 'include',
  });
  if (!res.ok) return [];
  return (await res.json()).connections;
}

async function createConnection(body: object, token: string): Promise<GitConnection> {
  const res = await fetch('/api/v1/git/connections', {
    method: 'POST', headers: authHeaders(token), credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json()).error?.message ?? 'Failed');
  return (await res.json()).connection;
}

async function deleteConnection(id: string, token: string): Promise<void> {
  await fetch(`/api/v1/git/connections/${id}`, {
    method: 'DELETE', headers: authHeaders(token), credentials: 'include',
  });
}

interface Props {
  workspaceId: string;
}

const PROVIDER_LABELS: Record<GitProvider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
};

const PROVIDER_ICONS: Record<GitProvider, JSX.Element> = {
  github: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  ),
  gitlab: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51 1.22 3.78a.84.84 0 0 1-.3.92z" />
    </svg>
  ),
};

export default function GitIntegrationSettings({ workspaceId }: Props) {
  const token = useStore(s => s.accessToken) ?? '';
  const qc    = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    provider: 'github' as GitProvider,
    repoOwner: '',
    repoName: '',
    webhookSecret: '',
  });

  const { data: connections = [], isLoading } = useQuery({
    queryKey:  ['git-connections', workspaceId],
    queryFn:   () => fetchConnections(workspaceId, token),
    enabled:   !!workspaceId && !!token,
  });

  const createMut = useMutation({
    mutationFn: (body: object) => createConnection(body, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['git-connections', workspaceId] });
      setShowForm(false);
      setForm({ provider: 'github', repoOwner: '', repoName: '', webhookSecret: '' });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteConnection(id, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['git-connections', workspaceId] }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createMut.mutate({ ...form, workspaceId });
  }

  if (isLoading) return <div className={styles.loading}>Loading…</div>;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Git Integration</h2>
          <p className={styles.subtitle}>
            Connect GitHub or GitLab repositories. PRs and commits mentioning issue keys (e.g.{' '}
            <code className={styles.code}>PF-42</code>) are linked automatically via webhooks.
          </p>
        </div>
        <button className={styles.addBtn} onClick={() => setShowForm(true)}>
          + Add Repository
        </button>
      </div>

      {showForm && (
        <form className={styles.form} onSubmit={handleSubmit}>
          <h3 className={styles.formTitle}>Connect Repository</h3>

          <div className={styles.field}>
            <label className={styles.label}>Provider</label>
            <div className={styles.providerRow}>
              {(['github', 'gitlab'] as GitProvider[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`${styles.providerBtn} ${form.provider === p ? styles.providerBtnActive : ''}`}
                  onClick={() => setForm(f => ({ ...f, provider: p }))}
                >
                  {PROVIDER_ICONS[p]}
                  {PROVIDER_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.label}>Owner / Org</label>
              <input
                className={styles.input}
                placeholder="e.g. acme-corp"
                value={form.repoOwner}
                onChange={e => setForm(f => ({ ...f, repoOwner: e.target.value }))}
                required
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Repository</label>
              <input
                className={styles.input}
                placeholder="e.g. my-app"
                value={form.repoName}
                onChange={e => setForm(f => ({ ...f, repoName: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Webhook Secret</label>
            <input
              className={styles.input}
              type="password"
              placeholder="Paste the secret you set in your repo webhook settings"
              value={form.webhookSecret}
              onChange={e => setForm(f => ({ ...f, webhookSecret: e.target.value }))}
              required
              minLength={8}
            />
            <p className={styles.hint}>
              Webhook URL: <code className={styles.code}>/api/v1/webhooks/{form.provider}</code>
            </p>
          </div>

          {createMut.isError && (
            <p className={styles.error}>{(createMut.error as Error).message}</p>
          )}

          <div className={styles.formActions}>
            <button type="button" className={styles.cancelBtn} onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button type="submit" className={styles.saveBtn} disabled={createMut.isPending}>
              {createMut.isPending ? 'Saving…' : 'Save Connection'}
            </button>
          </div>
        </form>
      )}

      {connections.length === 0 ? (
        <div className={styles.empty}>No repositories connected yet.</div>
      ) : (
        <ul className={styles.list}>
          {connections.map((conn) => (
            <li key={conn.id} className={styles.item}>
              <span className={styles.providerIcon}>{PROVIDER_ICONS[conn.provider]}</span>
              <div className={styles.repoInfo}>
                <span className={styles.repoName}>{conn.repoOwner}/{conn.repoName}</span>
                <span className={styles.providerLabel}>{PROVIDER_LABELS[conn.provider]}</span>
              </div>
              <span className={styles.connectedAt}>
                Connected {new Date(conn.createdAt).toLocaleDateString()}
              </span>
              <button
                className={styles.deleteBtn}
                onClick={() => deleteMut.mutate(conn.id)}
                disabled={deleteMut.isPending}
                aria-label="Remove connection"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
