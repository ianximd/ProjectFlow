// Pure shape mapping for task API rows.
// The Tasks table uses PascalCase SQL column names (Id, IssueKey, Title, …);
// some endpoints may also return camelCase. Both are handled here so callers
// always receive a stable camelCase Task shape.

export interface AssigneeRow {
  TaskId: string;
  Id?: string;
  UserId?: string;
  Name?: string | null;
  Email?: string;
  AvatarUrl?: string | null;
  [k: string]: unknown;
}

export interface Task {
  id: string;
  issueKey: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  type: string;
  storyPoints: number | null;
  startDate: string | null;
  dueDate: string | null;
  resolvedAt: string | null;
  position: number | null;
}

/** Non-empty string → string, otherwise null. */
const s = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

/** Numeric coercion: null/undefined/'' → null, NaN → null, anything else → Number(). */
const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const num = Number(v);
  return Number.isNaN(num) ? null : num;
};

export function normalizeTask(r: any): Task {
  return {
    id:          String(r?.Id          ?? r?.id          ?? ''),
    issueKey:    s(r?.IssueKey         ?? r?.issueKey),
    title:       String(r?.Title       ?? r?.title       ?? '(untitled)'),
    description: s(r?.Description      ?? r?.description),
    status:      String(r?.Status      ?? r?.status      ?? 'To Do'),
    priority:    String(r?.Priority    ?? r?.priority    ?? 'Medium'),
    type:        String(r?.Type        ?? r?.type        ?? 'TASK'),
    storyPoints: n(r?.StoryPoints      ?? r?.storyPoints),
    startDate:   s(r?.StartDate        ?? r?.startDate),
    dueDate:     s(r?.DueDate          ?? r?.dueDate),
    resolvedAt:  s(r?.ResolvedAt       ?? r?.resolvedAt),
    position:    n(r?.Position         ?? r?.position),
  };
}
