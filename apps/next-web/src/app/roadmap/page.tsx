'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Layout } from '@/components/Layout';
import { GanttChart } from '@/components/GanttChart';
import { useStore } from '@/store/useStore';
import styles from './roadmap.module.css';

// Hardcoded for MVP — same pattern as board/backlog pages
const PROJECT_ID   = '00000000-0000-0000-0000-000000000000';
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000000';

async function apiFetch(path: string, init?: RequestInit) {
  const token = useStore.getState().accessToken;
  const res   = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  });
  return res.json();
}

export default function RoadmapPage() {
  const router       = useRouter();
  const queryClient  = useQueryClient();
  const accessToken  = useStore((s) => s.accessToken);

  const { data, isLoading } = useQuery({
    queryKey: ['roadmap', PROJECT_ID, accessToken],
    queryFn: async () => {
      const json = await apiFetch(
        `/api/v1/roadmap?projectId=${PROJECT_ID}`,
      );
      if (json.error) { router.push('/login'); return { items: [], deps: [] }; }
      return json.data as { items: any[]; deps: any[] };
    },
  });

  const updateDatesMutation = useMutation({
    mutationFn: async ({
      taskId,
      startDate,
      dueDate,
    }: {
      taskId: string;
      startDate: string | null;
      dueDate: string | null;
    }) =>
      apiFetch(`/api/v1/roadmap/tasks/${taskId}/dates`, {
        method: 'PATCH',
        body: JSON.stringify({
          startDate,
          dueDate,
          clearStartDate: startDate === null,
          clearDueDate:   dueDate   === null,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roadmap', PROJECT_ID] });
    },
  });

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <h2 className={styles.title}>Roadmap</h2>
          <p className={styles.subtitle}>
            Gantt-style timeline of epics and tasks. Drag bars to adjust dates.
          </p>
        </div>

        {isLoading ? (
          <p style={{ color: 'var(--color-text-secondary)' }}>Loading…</p>
        ) : (
          <div className={styles.chart}>
            <GanttChart
              items={data?.items ?? []}
              deps={data?.deps ?? []}
              onUpdateDates={(taskId, startDate, dueDate) =>
                updateDatesMutation.mutate({ taskId, startDate, dueDate })
              }
            />
          </div>
        )}
      </div>
    </Layout>
  );
}
