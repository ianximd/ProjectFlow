import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';

export interface WorkspaceDetail {
  id: string;
  name: string;
  slug: string;
  avatarUrl: string | null;
  status: string;
}

export const getWorkspace = cache(async (id: string): Promise<WorkspaceDetail> => {
  const r = await serverFetch<any>(`/workspaces/${encodeURIComponent(id)}`);
  return {
    id:        String(r?.Id ?? r?.id ?? id),
    name:      String(r?.Name ?? r?.name ?? ''),
    slug:      String(r?.Slug ?? r?.slug ?? ''),
    avatarUrl: (r?.AvatarUrl ?? r?.avatarUrl) || null,
    status:    String(r?.Status ?? r?.status ?? 'ACTIVE'),
  };
});

export interface MemberRow {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  roleSlugs: string;
  isOwner: boolean;
  joinedAt: string | null;
}

export const getWorkspaceMembers = cache(async (id: string): Promise<MemberRow[]> => {
  const data = await serverFetch<any[]>(`/workspaces/${encodeURIComponent(id)}/members`);
  return (data ?? []).map((r) => ({
    id:        String(r?.Id ?? r?.id ?? ''),
    email:     String(r?.Email ?? r?.email ?? ''),
    name:      (r?.Name ?? r?.name) || null,
    avatarUrl: (r?.AvatarUrl ?? r?.avatarUrl) || null,
    roleSlugs: String(r?.RoleSlugs ?? r?.roleSlugs ?? ''),
    isOwner:   Boolean(r?.IsOwner ?? r?.isOwner),
    joinedAt:  (r?.JoinedAt ?? r?.joinedAt) || null,
  }));
});
