'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useStore } from '@/store/useStore';
import AutomationRuleBuilder from '@/components/AutomationRuleBuilder';
import styles from './automations.module.css';

interface Project { id: string; name: string; }

async function fetchProjects(token: string): Promise<Project[]> {
  const res = await fetch('/api/v1/projects', {
    credentials: 'include',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.projects ?? data ?? [];
}

export default function AutomationsPage() {
  const token = useStore(s => s.accessToken) ?? '';
  const [selectedProject, setSelectedProject] = useState('');

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects-list'],
    queryFn:  () => fetchProjects(token),
    enabled:  Boolean(token),
  });

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Automations</h1>
        <div className={styles.controls}>
          <label className={styles.selectLabel}>Project</label>
          {isLoading ? (
            <span className={styles.loading}>Loading…</span>
          ) : (
            <select
              className={styles.select}
              value={selectedProject}
              onChange={e => setSelectedProject(e.target.value)}
            >
              <option value="">— select project —</option>
              {projects?.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
        </div>
      </header>

      {selectedProject ? (
        <AutomationRuleBuilder projectId={selectedProject} />
      ) : (
        <div className={styles.placeholder}>
          <p>Select a project to view and manage its automation rules.</p>
        </div>
      )}
    </div>
  );
}
