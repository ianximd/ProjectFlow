'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useStore } from '@/store/useStore';
import type { OutgoingWebhook, WebhookDelivery, OutgoingWebhookEvent } from '@projectflow/types';
import styles from './WebhookManager.module.css';

const ALL_EVENTS: OutgoingWebhookEvent[] = [
  'issue.created',
  'issue.updated',
  'issue.deleted',
  'sprint.started',
  'sprint.completed',
  'comment.created',
  'member.invited',
];

interface Props {
  workspaceId: string;
}

async function apiFetch(url: string, token: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? 'Request failed');
  }
  return res.json();
}

export default function WebhookManager({ workspaceId }: Props) {
  const token = useStore(s => s.accessToken) ?? '';
  const qc    = useQueryClient();

  const [showForm, setShowForm]   = useState(false);
  const [name, setName]           = useState('');
  const [url, setUrl]             = useState('');
  const [secret, setSecret]       = useState('');
  const [events, setEvents]       = useState<OutgoingWebhookEvent[]>(['issue.created']);
  const [formError, setFormError] = useState('');

  const [expandedDeliveries, setExpandedDeliveries] = useState<Record<string, boolean>>({});
  const [deliveriesMap, setDeliveriesMap]           = useState<Record<string, WebhookDelivery[]>>({});

  // ── fetch webhooks ────────────────────────────────────────────────────────
  const { data: webhooks = [], isLoading } = useQuery<OutgoingWebhook[]>({
    queryKey:  ['outgoing-webhooks', workspaceId],
    queryFn:   async () => {
      const res = await apiFetch(`/api/v1/outgoing-webhooks?workspaceId=${workspaceId}`, token);
      return res.data;
    },
    enabled: !!workspaceId && !!token,
  });

  // ── create ────────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async () => {
      return apiFetch('/api/v1/outgoing-webhooks', token, {
        method: 'POST',
        body: JSON.stringify({ workspaceId, name, url, secret, events }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['outgoing-webhooks', workspaceId] });
      setShowForm(false);
      setName(''); setUrl(''); setSecret('');
      setEvents(['issue.created']);
      setFormError('');
    },
    onError: (err: any) => setFormError(err.message),
  });

  // ── delete ────────────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/v1/outgoing-webhooks/${id}`, token, { method: 'DELETE' }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['outgoing-webhooks', workspaceId] }),
  });

  // ── ping ──────────────────────────────────────────────────────────────────
  const pingMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/v1/outgoing-webhooks/${id}/ping?workspaceId=${workspaceId}`, token, { method: 'POST' }),
    onSuccess: (data, id) => {
      alert(data.data.success
        ? `Ping succeeded (HTTP ${data.data.statusCode})`
        : `Ping failed (HTTP ${data.data.statusCode ?? 'no response'})`);
    },
  });

  // ── deliveries ────────────────────────────────────────────────────────────
  async function loadDeliveries(id: string) {
    const expanded = !expandedDeliveries[id];
    setExpandedDeliveries(prev => ({ ...prev, [id]: expanded }));
    if (expanded && !deliveriesMap[id]) {
      const res = await apiFetch(`/api/v1/outgoing-webhooks/${id}/deliveries`, token);
      setDeliveriesMap(prev => ({ ...prev, [id]: res.data }));
    }
  }

  function toggleEvent(ev: OutgoingWebhookEvent) {
    setEvents(prev =>
      prev.includes(ev) ? prev.filter(e => e !== ev) : [...prev, ev],
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className={styles.title}>Outgoing Webhooks</h2>
        {!showForm && (
          <button className={styles.addBtn} onClick={() => setShowForm(true)}>
            + Add Webhook
          </button>
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <div className={styles.form}>
          <p className={styles.formTitle}>New outgoing webhook</p>

          <div>
            <label className={styles.label}>Name</label>
            <input className={styles.input} value={name} onChange={e => setName(e.target.value)} placeholder="My webhook" />
          </div>

          <div>
            <label className={styles.label}>Payload URL</label>
            <input className={styles.input} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/hook" />
          </div>

          <div>
            <label className={styles.label}>Secret (min 8 chars — used for HMAC-SHA256 signature)</label>
            <input
              className={styles.input}
              type="password"
              value={secret}
              onChange={e => setSecret(e.target.value)}
              placeholder="supersecret"
            />
          </div>

          <div>
            <label className={styles.label}>Subscribe to events</label>
            <div className={styles.eventsGrid}>
              {ALL_EVENTS.map(ev => (
                <label key={ev} className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={events.includes(ev)}
                    onChange={() => toggleEvent(ev)}
                  />
                  {ev}
                </label>
              ))}
            </div>
          </div>

          {formError && <p className={styles.error}>{formError}</p>}

          <div className={styles.formActions}>
            <button
              className={styles.saveBtn}
              disabled={!name || !url || !secret || events.length === 0 || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? 'Saving…' : 'Save webhook'}
            </button>
            <button className={styles.cancelBtn} onClick={() => { setShowForm(false); setFormError(''); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Webhook list */}
      {isLoading ? (
        <p className={styles.empty}>Loading…</p>
      ) : webhooks.length === 0 ? (
        <p className={styles.empty}>No outgoing webhooks configured. Add one to start receiving events.</p>
      ) : (
        webhooks.map(wh => (
          <div key={wh.id} className={styles.webhookCard}>
            <div className={styles.webhookHeader}>
              <div>
                <p className={styles.webhookName}>{wh.name}</p>
                <p className={styles.webhookUrl}>{wh.url}</p>
              </div>
              <div className={styles.cardActions}>
                <button
                  className={styles.pingBtn}
                  onClick={() => pingMutation.mutate(wh.id)}
                  disabled={pingMutation.isPending}
                >
                  Ping
                </button>
                <button
                  className={styles.deleteBtn}
                  onClick={() => { if (confirm('Delete this webhook?')) deleteMutation.mutate(wh.id); }}
                >
                  Remove
                </button>
              </div>
            </div>

            <div className={styles.webhookEvents}>
              {wh.events.map(ev => (
                <span key={ev} className={styles.eventBadge}>{ev}</span>
              ))}
            </div>

            <button className={styles.deliveriesToggle} onClick={() => loadDeliveries(wh.id)}>
              {expandedDeliveries[wh.id] ? 'Hide' : 'Show'} recent deliveries
            </button>

            {expandedDeliveries[wh.id] && (
              deliveriesMap[wh.id] ? (
                deliveriesMap[wh.id].length === 0 ? (
                  <p style={{ fontSize: 12, color: '#7a869a', marginTop: 8 }}>No deliveries yet.</p>
                ) : (
                  <table className={styles.deliveriesTable}>
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Event</th>
                        <th>HTTP</th>
                        <th>Duration</th>
                        <th>Attempt</th>
                        <th>Delivered at</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deliveriesMap[wh.id].map(d => (
                        <tr key={d.id}>
                          <td><span className={d.success ? styles.successDot : styles.failDot} /></td>
                          <td>{d.event}</td>
                          <td>{d.statusCode ?? '–'}</td>
                          <td>{d.durationMs != null ? `${d.durationMs}ms` : '–'}</td>
                          <td>{d.attempt}</td>
                          <td>{new Date(d.deliveredAt).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              ) : (
                <p style={{ fontSize: 12, color: '#7a869a', marginTop: 8 }}>Loading…</p>
              )
            )}
          </div>
        ))
      )}
    </div>
  );
}
