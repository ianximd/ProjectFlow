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
