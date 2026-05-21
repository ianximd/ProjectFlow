import 'server-only';
import { cache } from 'react';
import type { GitConnection } from '@projectflow/types';
import { serverFetchBody } from '../api';

// GET /git/connections?workspaceId= returns a raw body { connections } (NOT a
// { data } envelope) — the pre-migration client read `json.connections ?? []`.
export const getGitConnections = cache(async (workspaceId: string): Promise<GitConnection[]> => {
  const body = await serverFetchBody<{ connections?: GitConnection[] }>(
    `/git/connections?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  return body?.connections ?? [];
});
