'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '@/components/Layout';
import { WorkflowEditor } from '@/components/WorkflowEditor';
import { useStore } from '@/store/useStore';
import styles from './workflows.module.css';

// MVP: use a hardcoded project id until project selector is wired to global state
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000000';

async function apiFetch(path: string, token: string | null) {
  const res = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    credentials: 'include',
  });
  return res.json();
}

interface Project { id: string; name: string; key: string; }

export default function WorkflowsPage() {
  const router      = useRouter();
  const accessToken = useStore(s => s.accessToken);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  const { data: projects, isLoading } = useQuery<Project[]>({
    queryKey: ['projects', WORKSPACE_ID, accessToken],
    queryFn:  async () => {
      const json = await apiFetch(
        `/api/v1/projects?workspaceId=${WORKSPACE_ID}`,
        accessToken,
      );
      if (json.error) { router.push('/login'); return []; }
      const list: Project[] = json.data ?? [];
      // auto-select first project
      if (list.length > 0 && !selectedProjectId) setSelectedProjectId(list[0].id);
      return list;
    },
  });

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <span className={styles.headerIcon}>⚙</span>
            <h1 className={styles.title}>Workflows</h1>
          </div>
        </div>

        <div className={styles.content}>
          <div className={styles.projectSelector}>
            <span className={styles.projectLabel}>Project:</span>
            <select
              className={styles.projectSelect}
              value={selectedProjectId}
              onChange={e => setSelectedProjectId(e.target.value)}
              disabled={isLoading}
            >
              {isLoading && <option>Loading…</option>}
              {(projects ?? []).map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.key})</option>
              ))}
            </select>
          </div>

          {selectedProjectId ? (
            <WorkflowEditor projectId={selectedProjectId} />
          ) : (
            <div className={styles.empty}>
              <span>⚙</span>
              <span>Select a project to manage its workflow.</span>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
