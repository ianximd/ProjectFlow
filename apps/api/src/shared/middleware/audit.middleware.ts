import type { Context, Next } from 'hono';
import { adminService } from '../../modules/admin/admin.service.js';
import { getSnapshotFetcher, computeChangedFields, type SnapshotRow } from './audit-snapshots.js';

/**
 * Audit middleware — runs around the handler for POST/PATCH/PUT/DELETE.
 *
 * Extracts: userId, userEmail, IP, UserAgent, HTTP method → action, URL path → resource.
 * Only logs 2xx responses so failed requests (validation errors, 401s) are not audited
 * as successful write operations.
 *
 * Phase 6 W43 — also captures field-level diffs for UPDATE / DELETE when a
 * snapshot fetcher is registered for the resource. The middleware:
 *   1. resolves the resource + resourceId from the path BEFORE running the
 *      handler;
 *   2. for UPDATE/DELETE with a known resourceId AND a registered fetcher,
 *      snapshots the row PRE-handler;
 *   3. runs the handler;
 *   4. for UPDATE (POST/PATCH/PUT against an existing id), snapshots the
 *      row POST-handler and computes which keys changed;
 *   5. writes the picked OldValues / NewValues into AuditLog.
 *
 * CREATE without a resource id in the URL (e.g. POST /tasks) cannot
 * capture a NewValues body without parsing the response — that's a known
 * gap and is documented in CHANGELOG. The audit row for CREATE still
 * records who/what/when, just not the field-level body.
 *
 * Mount this AFTER authMiddleware so ctx.get('user') is populated.
 */
export async function auditMiddleware(c: Context, next: Next) {
  const method = c.req.method.toUpperCase();
  const isWrite = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);

  const resource   = isWrite ? pathToResource(c.req.path) : '';
  const resourceId = isWrite ? extractResourceId(c.req.path) : null;
  const wantDiff   = isWrite && method !== 'POST' && resourceId !== null;

  let beforeState: SnapshotRow | null = null;
  if (wantDiff) {
    const fetcher = getSnapshotFetcher(resource);
    if (fetcher) {
      try {
        beforeState = await fetcher(resourceId!);
      } catch {
        // If the snapshot can't be loaded (deleted, permission issue, SP error)
        // we just degrade to a diff-less audit row. Never block the request.
        beforeState = null;
      }
    }
  }

  await next();

  if (!isWrite) return;
  if (c.res.status < 200 || c.res.status >= 300) return;

  const user: any = c.get('user');
  if (!user) return;  // unauthenticated — skip

  const action = methodToAction(method);
  const ip        = c.req.header('CF-Connecting-IP')
                 || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim()
                 || null;
  const userAgent = c.req.header('User-Agent')?.slice(0, 512) ?? null;

  // Compute the field-level diff. For DELETE we don't try to fetch
  // after-state (the row may be gone OR soft-deleted with a stamp; we'd
  // either miss the row entirely or get a "deletedAt was null, now isn't"
  // diff that buries the real interesting before-state).
  let afterState: SnapshotRow | null = null;
  if (wantDiff && method !== 'DELETE') {
    const fetcher = getSnapshotFetcher(resource);
    if (fetcher) {
      try {
        afterState = await fetcher(resourceId!);
      } catch {
        afterState = null;
      }
    }
  }

  const diff = wantDiff
    ? computeChangedFields(beforeState, method === 'DELETE' ? null : afterState)
    : { oldValues: null, newValues: null };

  adminService.log({
    userId:     user.userId ?? user.id,
    userEmail:  user.email  ?? null,
    action,
    resource,
    resourceId,
    oldValues:  diff.oldValues as any,
    newValues:  diff.newValues as any,
    ipAddress:  ip,
    userAgent,
  });
}

function methodToAction(method: string): string {
  switch (method) {
    case 'POST':   return 'CREATE';
    case 'PATCH':
    case 'PUT':    return 'UPDATE';
    case 'DELETE': return 'DELETE';
    default:       return method;
  }
}

/**
 * Derive a clean resource name from the URL path.
 * /api/v1/tasks/abc-123/transition  →  'Task'
 */
function pathToResource(path: string): string {
  const segment = path.replace(/^\/api\/v1\//, '').split('/')[0];
  const map: Record<string, string> = {
    'tasks':              'Task',
    'projects':           'Project',
    'sprints':            'Sprint',
    'workspaces':         'Workspace',
    'comments':           'Comment',
    'attachments':        'Attachment',
    'automations':        'AutomationRule',
    'workflows':          'Workflow',
    'worklogs':           'WorkLog',
    'versions':           'Version',
    'labels':             'Label',
    'components':         'Component',
    'epics':              'Epic',
    'git':                'GitIntegration',
    'webhooks':           'Webhook',
    'outgoing-webhooks':  'OutgoingWebhook',
    'integrations':       'Integration',
    'notifications':      'Notification',
    'auth':               'Auth',
    'admin':              'Admin',
  };
  return map[segment] ?? segment;
}

/**
 * Extract the last UUID-shaped segment as the resource ID.
 * /tasks/abc-123/transition  →  'abc-123'
 */
function extractResourceId(path: string): string | null {
  const segments = path.split('/').filter(Boolean);
  // Walk backwards to find a UUID-ish segment (not a keyword like 'transition')
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    if (/^[0-9a-f-]{20,}$/i.test(s)) return s;
  }
  return null;
}
