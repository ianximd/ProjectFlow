import 'server-only';
import { cache } from 'react';
import type { ProjectComponent } from '@projectflow/types';
import { serverFetchBody } from '../api';

// GET /components?projectId= returns { components: [...] } — not the standard { data } envelope.
// The component service already returns clean camelCase rows matching the ProjectComponent type.

export const getComponents = cache(async (projectId: string): Promise<ProjectComponent[]> => {
  const body = await serverFetchBody<{ components: ProjectComponent[] }>(
    `/components?projectId=${encodeURIComponent(projectId)}`,
  );
  return (body?.components ?? []).map((c) => ({
    ...c,
    id:          String(c?.id ?? ''),
    name:        String(c?.name ?? ''),
    description: (c?.description ?? null) as string | null,
    issueCount:  Number(c?.issueCount ?? 0),
  }));
});
