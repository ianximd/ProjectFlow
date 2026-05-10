'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useStore } from '@/store/useStore';
import type {
  IntegrationConnection,
  IntegrationEvent,
  IntegrationProvider,
} from '@projectflow/types';
import styles from './slack-teams.module.css';

// ── helpers ───────────────────────────────────────────────────────────────────

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

const ALL_EVENTS: { value: IntegrationEvent; label: string }[] = [
  { value: 'task.created',      label: 'Task created'      },
  { value: 'task.transitioned', label: 'Task transitioned' },
  { value: 'sprint.started',    label: 'Sprint started'    },
  { value: 'sprint.completed',  label: 'Sprint completed'  },
];

const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  slack:   'Slack',
  msteams: 'Microsoft Teams',
};

const PROVIDER_EMOJI: Record<IntegrationProvider, string> = {
  slack:   '💬',
  msteams: '📘',
};

async function fetchConnections(
  workspaceId: string,
  token: string,
): Promise<IntegrationConnection[]> {
  const res = await fetch(`/api/v1/integrations?workspaceId=${workspaceId}`, {
    headers: authHeaders(token),
    credentials: 'include',
  });
  if (!res.ok) return [];
  const json = await res.json();
  return json.data ?? [];
}

// ── component ─────────────────────────────────────────────────────────────────

interface Props {
  workspaceId: string;
}

const DEFAULT_EVENTS: IntegrationEvent[] = [
  'task.created',
  'task.transitioned',
  'sprint.started',
  'sprint.completed',
];

export default function SlackTeamsSettings({ workspaceId }: Props) {
  const token = useStore((s) => s.accessToken) ?? '';
  const qc    = useQueryClient();

  const [showForm,   setShowForm]   = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'ok' | 'err'>('idle');
  const [testError,  setTestError]  = useState('');

  const [form, setForm] = useState({
    provider:    'slack' as IntegrationProvider,
    channelName: '',
    webhookUrl:  '',
    events:      [...DEFAULT_EVENTS] as IntegrationEvent[],
  });

  // ── queries ────────────────────────────────────────────────────────────────

  const { data: connections = [], isLoading } = useQuery<IntegrationConnection[]>({
    queryKey: ['integrations', workspaceId],
    queryFn:  () => fetchConnections(workspaceId, token),
    enabled:  !!workspaceId && !!token,
  });

  // ── mutations ──────────────────────────────────────────────────────────────

  const createMut = useMutation({
    mutationFn: async (body: object) => {
      const res = await fetch('/api/v1/integrations', {
        method:  'POST',
        headers: authHeaders(token),
        credentials: 'include',
        body:    JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error?.message ?? 'Failed');
      return (await res.json()).data as IntegrationConnection;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations', workspaceId] });
      resetForm();
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/v1/integrations/${id}`, {
        method:  'DELETE',
        headers: authHeaders(token),
        credentials: 'include',
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations', workspaceId] }),
  });

  // ── helpers ────────────────────────────────────────────────────────────────

  function resetForm() {
    setShowForm(false);
    setTestStatus('idle');
    setTestError('');
    setForm({ provider: 'slack', channelName: '', webhookUrl: '', events: [...DEFAULT_EVENTS] });
  }

  function toggleEvent(event: IntegrationEvent) {
    setForm((f) => ({
      ...f,
      events: f.events.includes(event)
        ? f.events.filter((e) => e !== event)
        : [...f.events, event],
    }));
  }

  async function handleTest() {
    if (!form.webhookUrl) return;
    setTestStatus('idle');
    try {
      const res = await fetch('/api/v1/integrations/test', {
        method:  'POST',
        headers: authHeaders(token),
        credentials: 'include',
        body: JSON.stringify({ provider: form.provider, webhookUrl: form.webhookUrl }),
      });
      if (res.ok) {
        setTestStatus('ok');
      } else {
        const json = await res.json();
        setTestStatus('err');
        setTestError(json.error?.message ?? 'Delivery failed');
      }
    } catch (err: any) {
      setTestStatus('err');
      setTestError(err?.message ?? 'Network error');
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.events.length === 0) return;
    createMut.mutate({
      workspaceId,
      provider:    form.provider,
      channelName: form.channelName,
      webhookUrl:  form.webhookUrl,
      events:      form.events,
    });
  }

  // ── render ─────────────────────────────────────────────────────────────────

  if (isLoading) return <div className={styles.loading}>Loading…</div>;

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Slack &amp; Microsoft Teams</h2>
          <p className={styles.subtitle}>
            Send notifications to Slack channels or Teams channels when tasks or sprints change.
            Paste an <strong>Incoming Webhook URL</strong> from your Slack App or Teams connector.
          </p>
        </div>
        {!showForm && (
          <button className={styles.addBtn} onClick={() => setShowForm(true)}>
            + Add Connection
          </button>
        )}
      </div>

      {/* Add form */}
      {showForm && (
        <form className={styles.form} onSubmit={handleSubmit}>
          <h3 className={styles.formTitle}>New Connection</h3>

          {/* Provider */}
          <div className={styles.field}>
            <label className={styles.label}>Platform</label>
            <div className={styles.providerRow}>
              {(['slack', 'msteams'] as IntegrationProvider[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`${styles.providerBtn} ${form.provider === p ? styles.providerBtnActive : ''}`}
                  onClick={() => setForm((f) => ({ ...f, provider: p }))}
                >
                  {PROVIDER_EMOJI[p]} {PROVIDER_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          {/* Channel name */}
          <div className={styles.field}>
            <label className={styles.label}>Channel label</label>
            <input
              className={styles.input}
              placeholder={form.provider === 'slack' ? '#dev-alerts' : 'Dev Alerts channel'}
              value={form.channelName}
              onChange={(e) => setForm((f) => ({ ...f, channelName: e.target.value }))}
              required
            />
          </div>

          {/* Webhook URL */}
          <div className={styles.field}>
            <label className={styles.label}>Incoming Webhook URL</label>
            <input
              className={styles.input}
              type="url"
              placeholder={
                form.provider === 'slack'
                  ? 'https://hooks.slack.com/services/…'
                  : 'https://…webhook.office.com/…'
              }
              value={form.webhookUrl}
              onChange={(e) => setForm((f) => ({ ...f, webhookUrl: e.target.value }))}
              required
            />
          </div>

          {/* Events */}
          <div className={styles.field}>
            <label className={styles.label}>Notify on events</label>
            <div className={styles.eventsGrid}>
              {ALL_EVENTS.map(({ value, label }) => (
                <label key={value} className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={form.events.includes(value)}
                    onChange={() => toggleEvent(value)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {/* Test */}
          {form.webhookUrl && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button
                type="button"
                className={styles.testBtn}
                onClick={handleTest}
                disabled={!form.webhookUrl}
              >
                Send test message
              </button>
              {testStatus === 'ok'  && <span className={styles.testOk}>✓ Delivered</span>}
              {testStatus === 'err' && <span className={styles.testErr}>✗ {testError}</span>}
            </div>
          )}

          {/* Actions */}
          <div className={styles.formActions}>
            <button type="button" className={styles.cancelBtn} onClick={resetForm}>
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={createMut.isPending || form.events.length === 0}
            >
              {createMut.isPending ? 'Saving…' : 'Save Connection'}
            </button>
          </div>

          {createMut.isError && (
            <p className={styles.error}>{(createMut.error as Error).message}</p>
          )}
        </form>
      )}

      {/* Connection list */}
      {connections.length === 0 && !showForm ? (
        <p className={styles.empty}>No integrations configured yet.</p>
      ) : (
        <div className={styles.list}>
          {connections.map((c) => (
            <div key={c.id} className={styles.card}>
              <div
                className={`${styles.providerIcon} ${
                  c.provider === 'slack' ? styles.slackIcon : styles.teamsIcon
                }`}
              >
                {PROVIDER_EMOJI[c.provider]}
              </div>

              <div className={styles.cardBody}>
                <p className={styles.cardChannel}>{c.channelName}</p>
                <p className={styles.cardProvider}>{PROVIDER_LABELS[c.provider]}</p>
                <div className={styles.cardEvents}>
                  {c.events.map((ev) => (
                    <span key={ev} className={styles.eventTag}>{ev}</span>
                  ))}
                </div>
              </div>

              <button
                className={styles.deleteBtn}
                onClick={() => deleteMut.mutate(c.id)}
                disabled={deleteMut.isPending}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
