// Pure shape mapping for API rows. The API returns PascalCase from some
// endpoints and camelCase from others; every page used to re-do `raw.Id ?? raw.id`
// inline. Centralizing it here is the normalization the DAL owns (spec §3.3).
export interface Workspace {
  id: string;
  name: string;
}

export type ProjectType = 'KANBAN' | 'SCRUM' | 'BUSINESS';
export type ProjectStatus = 'ACTIVE' | 'ARCHIVED' | 'DELETED';

export interface Project {
  id: string;
  name: string;
  key: string;
  description: string | null;
  type: ProjectType;
  status: ProjectStatus;
  createdAt: string | null;
}

/** Non-empty string or null. */
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export function normalizeWorkspace(raw: any): Workspace {
  return {
    id: String(raw?.Id ?? raw?.id ?? ''),
    name: String(raw?.Name ?? raw?.name ?? ''),
  };
}

export function normalizeProject(raw: any): Project {
  return {
    id:          String(raw?.Id ?? raw?.id ?? ''),
    name:        String(raw?.Name ?? raw?.name ?? '(unnamed)'),
    key:         String(raw?.Key ?? raw?.key ?? '—'),
    description: str(raw?.Description ?? raw?.description),
    type:        String(raw?.Type ?? raw?.type ?? 'KANBAN') as ProjectType,
    status:      String(raw?.Status ?? raw?.status ?? 'ACTIVE') as ProjectStatus,
    createdAt:   str(raw?.CreatedAt ?? raw?.createdAt),
  };
}

// ─── Hierarchy (Phase 1) ──────────────────────────────────────────────────
export interface Folder {
  id: string;
  spaceId: string;
  parentFolderId: string | null;
  name: string;
  position: number;
  path: string;
}
export interface List {
  id: string;
  spaceId: string;
  folderId: string | null;
  name: string;
  position: number;
  path: string;
  isDefault: boolean;
}

export function normalizeFolder(r: any): Folder {
  return {
    id: String(r?.Id ?? r?.id ?? ''),
    spaceId: String(r?.SpaceId ?? r?.spaceId ?? ''),
    parentFolderId: r?.ParentFolderId ?? r?.parentFolderId ?? null,
    name: String(r?.Name ?? r?.name ?? ''),
    position: Number(r?.Position ?? r?.position ?? 0),
    path: String(r?.Path ?? r?.path ?? ''),
  };
}
export function normalizeList(r: any): List {
  return {
    id: String(r?.Id ?? r?.id ?? ''),
    spaceId: String(r?.SpaceId ?? r?.spaceId ?? ''),
    folderId: r?.FolderId ?? r?.folderId ?? null,
    name: String(r?.Name ?? r?.name ?? ''),
    position: Number(r?.Position ?? r?.position ?? 0),
    path: String(r?.Path ?? r?.path ?? ''),
    isDefault: Boolean(r?.IsDefault ?? r?.isDefault),
  };
}
