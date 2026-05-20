import 'server-only';
import { cache } from 'react';
import type { Label } from '@projectflow/types';
import { serverFetchBody } from '../api';

// GET /labels?projectId= returns { labels: [...] } — not the standard { data } envelope.
// The label service already returns clean camelCase rows matching the Label type.

export const getLabels = cache(async (projectId: string): Promise<Label[]> => {
  const body = await serverFetchBody<{ labels: Label[] }>(
    `/labels?projectId=${encodeURIComponent(projectId)}`,
  );
  return (body?.labels ?? []).map((l) => ({
    ...l,
    id:         String(l?.id ?? ''),
    name:       String(l?.name ?? ''),
    color:      String(l?.color ?? '#6c63ff'),
    issueCount: Number(l?.issueCount ?? 0),
  }));
});
