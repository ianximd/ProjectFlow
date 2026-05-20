import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';

export interface RoadmapData {
  items: any[];
  deps: any[];
}

export const getRoadmap = cache(async (projectId: string): Promise<RoadmapData> => {
  const data = await serverFetch<RoadmapData>(`/roadmap?projectId=${encodeURIComponent(projectId)}`);
  return { items: data?.items ?? [], deps: data?.deps ?? [] };
});
