import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';

export interface Comment {
  id: string;
  authorId: string;
  authorName: string | null;
  authorAvatarUrl: string | null;
  body: string;
  isEdited: boolean;
  createdAt: string;
  reactions?: { emoji: string; count: number }[];
  assignedToId?: string | null;
  resolvedAt?: string | null;
}

// GET /comments?taskId= returns the standard { data: Comment[] } envelope
// (the pre-migration client read `json.data ?? []`).
export const getComments = cache(async (taskId: string): Promise<Comment[]> => {
  return (await serverFetch<Comment[]>(`/comments?taskId=${encodeURIComponent(taskId)}`)) ?? [];
});
