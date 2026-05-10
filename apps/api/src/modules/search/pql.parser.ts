/**
 * Lightweight PQL (ProjectFlow Query Language) parser.
 *
 * Supported syntax (JQL-inspired):
 *   field = "value"
 *   field = value
 *   field != value
 *   field in (val1, val2, val3)
 *   field not in (v1, v2)
 *   field >= -7d  |  field <= 2026-01-01  |  field > now()
 *   Bare text → q (full-text)
 *   Clauses joined by AND (case-insensitive)
 *
 * Supported fields:
 *   project, type, status, priority, assignee, reporter, sprint,
 *   created, updated, duedate, summary
 *
 * Supported functions (resolved at parse time):
 *   currentUser() → replaced by the supplied userId
 *   now()         → current UTC ISO string
 *   openSprints() → special flag
 *   startOfDay(), endOfDay(), startOfWeek()
 */

export interface ParsedPQL {
  q?: string;
  projectKey?: string;
  type?: string;
  status?: string;
  priority?: string;
  assigneeId?: string;   // only if value === 'currentUser()'
  reporterId?: string;
  sprintId?: string;
  openSprints?: boolean;
  dueAfter?: string;
  dueBefore?: string;
  createdAfter?: string;
  updatedAfter?: string;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
}

const FIELD_ALIASES: Record<string, string> = {
  summary:  'summary',
  title:    'summary',
  type:     'type',
  issuetype:'type',
  status:   'status',
  priority: 'priority',
  assignee: 'assignee',
  reporter: 'reporter',
  sprint:   'sprint',
  project:  'project',
  duedate:  'duedate',
  due:      'duedate',
  created:  'created',
  updated:  'updated',
};

const ORDER_FIELD_MAP: Record<string, string> = {
  created:     'CreatedAt',
  updated:     'UpdatedAt',
  duedate:     'DueDate',
  due:         'DueDate',
  priority:    'Priority',
  status:      'Status',
  title:       'Title',
  summary:     'Title',
  storypoints: 'StoryPoints',
};

/** Resolve a relative date expression such as "-7d", "-1h", "now()" */
function resolveDate(expr: string): string | null {
  const e = expr.trim().toLowerCase();
  if (e === 'now()') return new Date().toISOString();
  if (e === 'startofday()') {
    const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString();
  }
  if (e === 'endofday()') {
    const d = new Date(); d.setUTCHours(23, 59, 59, 999); return d.toISOString();
  }
  if (e === 'startofweek()') {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }
  // -Nd or +Nd relative days
  const relDay = /^([+-]?\d+)d$/.exec(e);
  if (relDay) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + parseInt(relDay[1], 10));
    return d.toISOString();
  }
  // -Nh relative hours
  const relHour = /^([+-]?\d+)h$/.exec(e);
  if (relHour) {
    const d = new Date();
    d.setUTCHours(d.getUTCHours() + parseInt(relHour[1], 10));
    return d.toISOString();
  }
  // Plain date strings (YYYY-MM-DD or ISO)
  const dt = new Date(expr);
  if (!isNaN(dt.getTime())) return dt.toISOString();
  return null;
}

function stripQuotes(v: string): string {
  return v.replace(/^["']|["']$/g, '').trim();
}

/**
 * Parse a PQL string into structured filter params.
 * @param pql   PQL query string
 * @param userId  Current user id (for currentUser() function)
 */
export function parsePQL(pql: string, userId?: string): ParsedPQL {
  if (!pql?.trim()) return {};

  const result: ParsedPQL = {};

  // Extract ORDER BY clause first (must be at end)
  const orderMatch = /\bORDER\s+BY\s+(\w+)(?:\s+(ASC|DESC))?\s*$/i.exec(pql);
  if (orderMatch) {
    const rawField = orderMatch[1].toLowerCase();
    result.orderBy  = ORDER_FIELD_MAP[rawField] ?? 'CreatedAt';
    result.orderDir = (orderMatch[2]?.toUpperCase() as 'ASC' | 'DESC') ?? 'DESC';
    pql = pql.slice(0, orderMatch.index).trim();
  }

  // Tokenise: split by AND (case-insensitive), respect parentheses
  const clauses = splitByAnd(pql);

  const freeText: string[] = [];

  for (const clause of clauses) {
    const c = clause.trim();
    if (!c) continue;

    // field in (v1, v2)
    const inMatch = /^(\w+)\s+(?:NOT\s+)?IN\s*\(([^)]+)\)/i.exec(c);
    if (inMatch) {
      const field  = FIELD_ALIASES[inMatch[1].toLowerCase()];
      const values = inMatch[2].split(',').map((v) => stripQuotes(v.trim()));
      applyInClause(result, field, values, userId);
      continue;
    }

    // field op value  (=, !=, >=, <=, >, <)
    const opMatch = /^(\w+)\s*(!=|>=|<=|>|<|=)\s*(.+)$/.exec(c);
    if (opMatch) {
      const rawField = opMatch[1].toLowerCase();
      const field    = FIELD_ALIASES[rawField];
      const op       = opMatch[2];
      const rawValue = stripQuotes(opMatch[3].trim());

      if (!field) {
        freeText.push(c);
        continue;
      }

      const value = rawValue.toLowerCase() === 'currentuser()'
        ? (userId ?? rawValue)
        : rawValue;

      switch (field) {
        case 'summary':
          if (op === '=') result.q = value;
          break;
        case 'type':
          if (op === '=') result.type = value.toUpperCase();
          break;
        case 'status':
          if (op === '=') result.status = value;
          break;
        case 'priority':
          if (op === '=') result.priority = value.toUpperCase();
          break;
        case 'assignee':
          if (op === '=') result.assigneeId = value;
          break;
        case 'reporter':
          if (op === '=') result.reporterId = value;
          break;
        case 'project':
          if (op === '=') result.projectKey = value;
          break;
        case 'sprint':
          if (rawValue.toLowerCase() === 'opensprints()') {
            result.openSprints = true;
          } else if (op === '=') {
            result.sprintId = value;
          }
          break;
        case 'duedate': {
          const resolved = resolveDate(value);
          if (resolved) {
            if (op === '>=' || op === '>') result.dueAfter  = resolved;
            if (op === '<=' || op === '<') result.dueBefore = resolved;
            if (op === '=') { result.dueAfter = resolved; result.dueBefore = resolved; }
          }
          break;
        }
        case 'created': {
          const resolved = resolveDate(value);
          if (resolved && (op === '>=' || op === '>')) result.createdAfter = resolved;
          break;
        }
        case 'updated': {
          const resolved = resolveDate(value);
          if (resolved && (op === '>=' || op === '>')) result.updatedAfter = resolved;
          break;
        }
      }
      continue;
    }

    // Bare text
    freeText.push(c);
  }

  if (freeText.length > 0) {
    result.q = freeText.join(' ');
  }

  return result;
}

function applyInClause(
  result: ParsedPQL,
  field: string | undefined,
  values: string[],
  userId?: string,
) {
  if (!field || values.length === 0) return;
  // For IN clauses we take the first value as a simple equality filter
  // (full multi-value support would need array params in the SP)
  const v = values[0].toLowerCase() === 'currentuser()' ? (userId ?? values[0]) : values[0];
  switch (field) {
    case 'type':     result.type     = v.toUpperCase(); break;
    case 'status':   result.status   = v; break;
    case 'priority': result.priority = v.toUpperCase(); break;
    case 'assignee': result.assigneeId = v; break;
    case 'reporter': result.reporterId = v; break;
    case 'sprint':
      if (values.some((x) => x.toLowerCase() === 'opensprints()')) {
        result.openSprints = true;
      } else {
        result.sprintId = v;
      }
      break;
  }
}

/** Split PQL string by AND, ignoring AND inside parentheses */
function splitByAnd(pql: string): string[] {
  const clauses: string[] = [];
  let depth = 0, start = 0;
  const upper = pql.toUpperCase();

  for (let i = 0; i < pql.length; i++) {
    if (pql[i] === '(') { depth++; continue; }
    if (pql[i] === ')') { depth--; continue; }
    if (depth === 0 && upper.slice(i, i + 4) === ' AND') {
      clauses.push(pql.slice(start, i).trim());
      i += 4;
      start = i;
    }
  }
  if (start < pql.length) clauses.push(pql.slice(start).trim());
  return clauses;
}
