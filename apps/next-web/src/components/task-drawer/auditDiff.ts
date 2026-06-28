import type { AuditLogEntry } from '@projectflow/types';

/** Fields we render with friendly labels; anything else falls back to raw JSON. */
const KNOWN_FIELDS = new Set([
  'status', 'priority', 'title', 'description', 'startDate', 'dueDate',
  'storyPoints', 'assignees', 'type', 'name',
]);

function show(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

export interface AuditChange { field: string; from: string; to: string; }
export interface FormattedEntry { summary: string; changes: AuditChange[]; }

export function formatAuditEntry(entry: AuditLogEntry): FormattedEntry {
  const who = entry.userEmail ?? 'Someone';
  if (entry.action === 'CREATE') return { summary: `${who} created this task`, changes: [] };
  if (entry.action === 'DELETE') return { summary: `${who} deleted this task`, changes: [] };

  const oldV = entry.oldValues ?? {};
  const newV = entry.newValues ?? {};
  const keys = Array.from(new Set([...Object.keys(oldV), ...Object.keys(newV)]));
  const changes: AuditChange[] = keys
    .filter((k) => KNOWN_FIELDS.has(k) || k in oldV || k in newV)
    .map((field) => ({ field, from: show(oldV[field]), to: show(newV[field]) }))
    .filter((c) => c.from !== c.to);

  return { summary: `${who} updated this task`, changes };
}

export function groupByDay(entries: AuditLogEntry[]): { day: string; entries: AuditLogEntry[] }[] {
  const sorted = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const map = new Map<string, AuditLogEntry[]>();
  for (const e of sorted) {
    const day = e.createdAt.slice(0, 10); // YYYY-MM-DD
    const bucket = map.get(day) ?? [];
    if (!map.has(day)) map.set(day, bucket);
    bucket.push(e);
  }
  return Array.from(map.entries()).map(([day, es]) => ({ day, entries: es }));
}
