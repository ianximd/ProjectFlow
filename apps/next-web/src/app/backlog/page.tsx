'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Layout } from '@/components/Layout';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useStore } from '@/store/useStore';
import styles from './backlog.module.css';

export default function BacklogPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  // Access token lives in memory — never in localStorage
  const accessToken = useStore((s) => s.accessToken);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['backlog-tasks', accessToken],
    queryFn: async () => {
      const token = useStore.getState().accessToken;
      const res = await fetch(
        'http://localhost:3001/api/v1/tasks?projectId=00000000-0000-0000-0000-000000000000',
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.status === 401) { router.push('/login'); return []; }
      const json = await res.json();
      return json.data || [];
    },
  });

  const addMutation = useMutation({
    mutationFn: async (title: string) => {
      const token = useStore.getState().accessToken;
      const res = await fetch('http://localhost:3001/api/v1/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title,
          status: 'To Do',
          projectId: '00000000-0000-0000-0000-000000000000',
          workspaceId: '00000000-0000-0000-0000-000000000000',
        }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backlog-tasks'] });
      setNewTaskTitle('');
      setIsAdding(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const token = useStore.getState().accessToken;
      await fetch(`http://localhost:3001/api/v1/tasks/${taskId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['backlog-tasks'] }),
  });

  const handleAdd = () => {
    if (newTaskTitle.trim()) addMutation.mutate(newTaskTitle.trim());
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h2 className={styles.title}>Backlog</h2>
          <span className={styles.count}>{tasks.length} issues</span>
        </div>

        <div className={styles.list}>
          {isLoading ? (
            <div className={styles.loading}>Loading backlog...</div>
          ) : tasks.length === 0 ? (
            <div className={styles.empty}>No issues in the backlog. Create one below!</div>
          ) : (
            tasks.map((task: any) => (
              <div key={task.Id} className={styles.item}>
                <div className={styles.itemLeft}>
                  <span className={`${styles.statusBadge} ${styles[task.Status?.replace(' ', '').toLowerCase() || 'todo']}`}>
                    {task.Status || 'To Do'}
                  </span>
                  <span className={styles.issueKey}>{task.IssueKey}</span>
                  <span className={styles.itemTitle}>{task.Title}</span>
                </div>
                <div className={styles.itemRight}>
                  <span className={`${styles.priority} ${styles[task.Priority?.toLowerCase() || 'medium']}`}>
                    {task.Priority || 'MEDIUM'}
                  </span>
                  <button
                    className={styles.deleteBtn}
                    onClick={() => deleteMutation.mutate(task.Id)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className={styles.addSection}>
          {isAdding ? (
            <div className={styles.addForm}>
              <input
                autoFocus
                className={styles.addInput}
                placeholder="What needs to be done?"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAdd();
                  if (e.key === 'Escape') setIsAdding(false);
                }}
              />
              <div className={styles.addActions}>
                <button className={styles.addBtn} onClick={handleAdd} disabled={addMutation.isPending}>
                  {addMutation.isPending ? 'Adding...' : 'Add'}
                </button>
                <button className={styles.cancelBtn} onClick={() => setIsAdding(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className={styles.createBtn} onClick={() => setIsAdding(true)}>
              <Plus size={16} />
              Create Issue
            </button>
          )}
        </div>
      </div>
    </Layout>
  );
}
