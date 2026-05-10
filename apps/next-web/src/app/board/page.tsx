'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Layout } from '@/components/Layout';
import { Board } from '@/components/Board';
import { TaskDrawer } from '@/components/TaskDrawer';
import { useStore } from '@/store/useStore';
// import type { Task } from '@projectflow/types';

export default function BoardPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [selectedTask, setSelectedTask] = useState<any | null>(null);
  // Access token lives in memory — never in localStorage
  const accessToken = useStore((s) => s.accessToken);

  const { data: tasks, isLoading } = useQuery({
    queryKey: ['tasks', accessToken],
    queryFn: async () => {
      const token = useStore.getState().accessToken;
      // Hardcoded Project ID for MVP Phase 1
      const res = await fetch('http://localhost:3001/api/v1/tasks?projectId=00000000-0000-0000-0000-000000000000', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.status === 401) {
        router.push('/login');
        return [];
      }
      const json = await res.json();
      return json.data || [];
    }
  });

  const moveTaskMutation = useMutation({
    mutationFn: async ({ taskId, newStatus }: { taskId: string, newStatus: string }) => {
      const token = useStore.getState().accessToken;
      const res = await fetch(`http://localhost:3001/api/v1/tasks/${taskId}/transition`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    }
  });

  const addTaskMutation = useMutation({
    mutationFn: async ({ columnId, content }: { columnId: string, content: string }) => {
      const token = useStore.getState().accessToken;
      const res = await fetch(`http://localhost:3001/api/v1/tasks`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          title: content, 
          status: columnId,
          projectId: '00000000-0000-0000-0000-000000000000',
          workspaceId: '00000000-0000-0000-0000-000000000000'
        })
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    }
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const token = useStore.getState().accessToken;
      const res = await fetch(`http://localhost:3001/api/v1/tasks/${taskId}`, {
        method: 'DELETE',
        headers: { 
          'Authorization': `Bearer ${token}`
        }
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    }
  });

  return (
    <Layout>
      {isLoading ? (
        <div className="p-8">Loading tasks from MSSQL...</div>
      ) : (
        <Board 
          initialTasks={tasks} 
          onMoveTask={(taskId: string, newStatus: string) => moveTaskMutation.mutate({ taskId, newStatus })}
          onAddTask={(columnId: string, content: string) => addTaskMutation.mutate({ columnId, content })}
          onDeleteTask={(taskId: string) => deleteTaskMutation.mutate(taskId)}
          onOpenTask={(task) => setSelectedTask(task)}
        />
      )}
      <TaskDrawer task={selectedTask} onClose={() => setSelectedTask(null)} />
    </Layout>
  );
}
