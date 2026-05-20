import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';
import { normalizeProject, type Project } from './normalize';

/** Projects in a workspace, normalized. Deduped per render. */
export const getProjects = cache(async (workspaceId: string): Promise<Project[]> => {
  const data = await serverFetch<any[]>(`/projects?workspaceId=${encodeURIComponent(workspaceId)}`);
  return (data ?? []).map(normalizeProject);
});
