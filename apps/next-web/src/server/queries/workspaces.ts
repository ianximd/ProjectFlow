import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';
import { normalizeWorkspace, type Workspace } from './normalize';

/** All workspaces for the current session, normalized. Deduped per render. */
export const getWorkspaces = cache(async (): Promise<Workspace[]> => {
  const data = await serverFetch<any[]>('/workspaces');
  return (data ?? []).map(normalizeWorkspace);
});

/** Workspace list with the extra fields the /workspaces page renders
 *  (slug + owner). The core Workspace type stays minimal for context/switcher. */
export interface WorkspaceListItem {
  id: string;
  name: string;
  slug: string;
  ownerId: string | null;
}
export const getWorkspacesDetailed = cache(async (): Promise<WorkspaceListItem[]> => {
  const data = await serverFetch<any[]>('/workspaces');
  return (data ?? []).map((r) => ({
    id:      String(r?.Id ?? r?.id ?? ''),
    name:    String(r?.Name ?? r?.name ?? '(unnamed)'),
    slug:    String(r?.Slug ?? r?.slug ?? ''),
    ownerId: (r?.OwnerId ?? r?.ownerId) ? String(r?.OwnerId ?? r?.ownerId) : null,
  }));
});
