import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';
import { normalizeWorkspace, type Workspace } from './normalize';

/** All workspaces for the current session, normalized. Deduped per render. */
export const getWorkspaces = cache(async (): Promise<Workspace[]> => {
  const data = await serverFetch<any[]>('/workspaces');
  return (data ?? []).map(normalizeWorkspace);
});
