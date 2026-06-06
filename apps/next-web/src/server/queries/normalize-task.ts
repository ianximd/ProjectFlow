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

/** Lightweight assignee projection carried on a view task (engine Board avatars). */
export interface TaskAssignee {
  userId: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}

export interface Task {
  id: string;
  listId: string | null;
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
  sprintId: string | null;
  /** Custom-field values keyed by lowercased FieldId, parsed from their stored
   *  JSON (number/boolean/string/array). Empty when the row carries none — only
   *  the Views engine task projection populates these. */
  customFieldValues: Record<string, unknown>;
  /** Assignees (Views engine projection) for the engine Board's avatar stacks.
   *  Empty for task rows that don't carry them (e.g. the REST list path, whose
   *  assignees travel separately in `assigneesByTaskId`). */
  assignees: TaskAssignee[];
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

/**
 * Parse the `customFieldValues` payload (a JSON object string of
 * `{ [fieldId]: rawStoredJsonString }`) into `{ [fieldId]: parsedValue }`.
 * Each stored value is itself JSON ('8' → 8, '"hi"' → 'hi', '["a","b"]' →
 * ['a','b']); a value that fails to parse is kept as its raw string. Returns
 * an empty object for null/empty/malformed input so callers can index safely.
 */
function parseCustomFieldValues(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || raw.length === 0) return {};
  let outer: Record<string, unknown>;
  try { outer = JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
  if (outer == null || typeof outer !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(outer)) {
    if (typeof v === 'string') {
      try { out[k] = JSON.parse(v); } catch { out[k] = v; }
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function normalizeTask(r: any): Task {
  return {
    id:          String(r?.Id          ?? r?.id          ?? ''),
    listId:      s(r?.ListId           ?? r?.listId),
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
    sprintId:    s(r?.SprintId         ?? r?.sprintId),
    customFieldValues: parseCustomFieldValues(r?.customFieldValues ?? r?.CustomFieldValues),
    assignees:   normalizeAssignees(r?.assignees ?? r?.Assignees),
  };
}

/** Map GraphQL (camelCase) or raw SQL (PascalCase) assignee rows to TaskAssignee[]. */
function normalizeAssignees(raw: unknown): TaskAssignee[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((a: any) => ({
    userId:    String(a?.userId ?? a?.UserId ?? ''),
    name:      s(a?.name      ?? a?.Name),
    email:     s(a?.email     ?? a?.Email),
    avatarUrl: s(a?.avatarUrl ?? a?.AvatarUrl),
  }));
}
