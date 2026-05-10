'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
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

  const { data: workspaces, isLoading: isLoadingWs } = useQuery({
    queryKey: ['workspaces', accessToken],
    queryFn: async () => {
      const token = useStore.getState().accessToken;
      const res = await fetch('http://localhost:3001/api/v1/workspaces', { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.status === 401) { router.push('/login'); return []; }
      const json = await res.json();
      const wss = json.data || [];
      if (wss.length === 0) {
        router.push('/setup');
      }
      return wss;
    }
  });

  const workspaceId = workspaces?.[0]?.Id;

  const { data: projects, isLoading: isLoadingProj } = useQuery({
    queryKey: ['projects', workspaceId, accessToken],
    enabled: !!workspaceId,
    queryFn: async () => {
      const token = useStore.getState().accessToken;
      const res = await fetch(`http://localhost:3001/api/v1/projects?workspaceId=${workspaceId}`, { headers: { 'Authorization': `Bearer ${token}` } });
      const json = await res.json();
      return json.data || [];
    }
  });

  const projectId = projects?.[0]?.Id;

  const { data: tasks, isLoading: isLoadingTasks } = useQuery({
    queryKey: ['tasks', projectId, accessToken],
    enabled: !!projectId,
    queryFn: async () => {
      const token = useStore.getState().accessToken;
      const res = await fetch(`http://localhost:3001/api/v1/tasks?projectId=${projectId}`, { headers: { 'Authorization': `Bearer ${token}` } });
      const json = await res.json();
      return json.data || [];
    }
  });

  const isLoading = isLoadingWs || isLoadingProj || isLoadingTasks;

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
          projectId: projectId,
          workspaceId: workspaceId
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
    <>
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
    </>
  );
}
