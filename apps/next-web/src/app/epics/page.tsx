'use client';

import { useState } from 'react';
import { useQuery }  from '@tanstack/react-query';
import { useStore } from '@/store/useStore';
import type { EpicSummary } from '@projectflow/types';
import styles from './epics.module.css';

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function fetchProjects(token: string) {
  const res = await fetch('/api/v1/projects', {
    headers: authHeaders(token), credentials: 'include',
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.projects ?? data) as Array<{ id: string; name: string; key: string }>;
}

async function fetchEpics(projectId: string, token: string): Promise<EpicSummary[]> {
  const res = await fetch(`/api/v1/epics?projectId=${projectId}`, {
    headers: authHeaders(token), credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch epics');
  return (await res.json()).epics;
}

const PRIORITY_COLORS: Record<string, string> = {
  HIGHEST: '#f38ba8',
  HIGH:    '#fab387',
  MEDIUM:  '#f9e2af',
  LOW:     '#a6e3a1',
  LOWEST:  '#89dceb',
};

function ProgressRing({ total, done }: { total: number; done: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const r = 18;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <div className={styles.ringWrapper} title={`${done}/${total} done (${pct}%)`}>
      <svg width="44" height="44" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r={r} fill="none" stroke="#313244" strokeWidth="4" />
        <circle
          cx="22" cy="22" r={r} fill="none"
          stroke="#6c63ff" strokeWidth="4"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform="rotate(-90 22 22)"
        />
        <text x="22" y="26" textAnchor="middle" fontSize="9" fill="#cdd6f4">{pct}%</text>
      </svg>
    </div>
  );
}

export default function EpicsPage() {
  const token = useStore(s => s.accessToken) ?? '';
  const [projectId, setProjectId] = useState('');

  const { data: projects = [] } = useQuery({
    queryKey: ['projects-list'],
    queryFn:  () => fetchProjects(token),
    enabled:  !!token,
  });

  const { data: epics = [], isLoading } = useQuery({
    queryKey: ['epics', projectId],
    queryFn:  () => fetchEpics(projectId, token),
    enabled:  !!projectId,
  });

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Epics</h1>
        <select
          className={styles.projectSelect}
          value={projectId}
          onChange={e => setProjectId(e.target.value)}
        >
          <option value="">Select a project…</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>[{p.key}] {p.name}</option>
          ))}
        </select>
      </div>

      {!projectId ? (
        <div className={styles.noProject}>Select a project to view its epics.</div>
      ) : isLoading ? (
        <div className={styles.loading}>Loading epics…</div>
      ) : epics.length === 0 ? (
        <div className={styles.empty}>No epics found. Create an issue with type EPIC to get started.</div>
      ) : (
        <div className={styles.list}>
          {epics.map(epic => (
            <div key={epic.id} className={styles.epicCard}>
              <ProgressRing total={epic.totalChildren} done={epic.completedChildren} />
              <div className={styles.epicMain}>
                <div className={styles.epicTitle}>
                  <span className={styles.issueKey}>{epic.issueKey}</span>
                  <span className={styles.title}>{epic.title}</span>
                </div>
                <div className={styles.epicMeta}>
                  <span className={styles.status}>{epic.status}</span>
                  <span
                    className={styles.priority}
                    style={{ color: PRIORITY_COLORS[epic.priority] ?? '#a6adc8' }}
                  >
                    {epic.priority}
                  </span>
                  {epic.dueDate && <span className={styles.dueDate}>Due: {epic.dueDate}</span>}
                  <span className={styles.childCount}>
                    {epic.completedChildren}/{epic.totalChildren} stories done
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
