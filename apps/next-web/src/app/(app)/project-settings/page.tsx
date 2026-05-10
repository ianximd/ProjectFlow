'use client';

import { useState } from 'react';
import { useQuery }  from '@tanstack/react-query';
import { useStore } from '@/store/useStore';
import LabelManager            from '@/components/LabelManager';
import ComponentManager        from '@/components/ComponentManager';
import GitIntegrationSettings  from '@/components/GitIntegrationSettings';
import SlackTeamsSettings      from '@/components/SlackTeamsSettings';
import WebhookManager          from '@/components/WebhookManager';
import styles from './project-settings.module.css';

async function fetchProjects(token: string) {
  const res = await fetch('/api/v1/projects', {
    headers: { Authorization: `Bearer ${token}` }, credentials: 'include',
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.projects ?? data) as Array<{ id: string; name: string; key: string; workspaceId: string }>;
}

type Tab = 'labels' | 'components' | 'git' | 'messaging' | 'webhooks';

export default function ProjectSettingsPage() {
  const token = useStore(s => s.accessToken) ?? '';
  const [projectId, setProjectId] = useState('');
  const [tab, setTab] = useState<Tab>('labels');

  const { data: projects = [] } = useQuery({
    queryKey:  ['projects-list'],
    queryFn:   () => fetchProjects(token),
    enabled:   !!token,
  });

  const selectedProject = projects.find(p => p.id === projectId);

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Project Configuration</h1>
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
        <>
          <div className={styles.tabs}>
            <button className={`${styles.tab} ${tab === 'labels'     ? styles.tabActive : ''}`} onClick={() => setTab('labels')}>Labels</button>
            <button className={`${styles.tab} ${tab === 'components' ? styles.tabActive : ''}`} onClick={() => setTab('components')}>Components</button>
            <button className={`${styles.tab} ${tab === 'git'        ? styles.tabActive : ''}`} onClick={() => setTab('git')}>Git Integration</button>
            <button className={`${styles.tab} ${tab === 'messaging'  ? styles.tabActive : ''}`} onClick={() => setTab('messaging')}>Slack &amp; Teams</button>
            <button className={`${styles.tab} ${tab === 'webhooks'   ? styles.tabActive : ''}`} onClick={() => setTab('webhooks')}>Webhooks</button>
          </div>
          <div className={styles.tabContent}>
            {tab === 'labels'     && <LabelManager     projectId={projectId} />}
            {tab === 'components' && <ComponentManager projectId={projectId} />}
            {tab === 'git'        && selectedProject && (
              <GitIntegrationSettings workspaceId={selectedProject.workspaceId} />
            )}
            {tab === 'messaging'  && selectedProject && (
              <SlackTeamsSettings workspaceId={selectedProject.workspaceId} />
            )}
            {tab === 'webhooks'   && selectedProject && (
              <WebhookManager workspaceId={selectedProject.workspaceId} />
            )}
          </div>
        </>
      ) : (
        <div className={styles.noProject}>Select a project to manage its configuration.</div>
      )}
    </div>
  );
}
