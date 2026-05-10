'use client';

import { useState } from 'react';
import { useQuery }  from '@tanstack/react-query';
import { useStore } from '@/store/useStore';
import VersionManager from '@/components/VersionManager';
import styles from './versions.module.css';

async function fetchProjects(token: string) {
  const res = await fetch('/api/v1/projects', {
    headers: { Authorization: `Bearer ${token}` }, credentials: 'include',
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.projects ?? data) as Array<{ id: string; name: string; key: string }>;
}

export default function VersionsPage() {
  const token = useStore(s => s.accessToken) ?? '';
  const [projectId, setProjectId] = useState('');

  const { data: projects = [] } = useQuery({
    queryKey:  ['projects-list'],
    queryFn:   () => fetchProjects(token),
    enabled:   !!token,
  });

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Versions</h1>
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

      {projectId ? (
        <VersionManager projectId={projectId} />
      ) : (
        <div className={styles.noProject}>Select a project to manage its versions.</div>
      )}
    </div>
  );
}
