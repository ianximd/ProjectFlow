import type { Context, Next } from 'hono';
import { adminService } from '../../modules/admin/admin.service.js';

/**
 * Audit middleware — runs after the handler for POST/PATCH/PUT/DELETE.
 *
 * Extracts: userId, userEmail, IP, UserAgent, HTTP method → action, URL path → resource.
 * Only logs 2xx responses so failed requests (validation errors, 401s) are not audited
 * as successful write operations.
 *
 * Mount this AFTER authMiddleware so ctx.get('user') is populated.
 * Usage: app.use('/tasks/*', auditMiddleware);
 */
export async function auditMiddleware(c: Context, next: Next) {
  await next();

  const method = c.req.method.toUpperCase();

  // Only audit write operations
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return;

  // Only audit successful responses (2xx)
  if (c.res.status < 200 || c.res.status >= 300) return;

  const user: any = c.get('user');
  if (!user) return;  // unauthenticated — skip

  const action   = methodToAction(method);
  const resource = pathToResource(c.req.path);
  const resourceId = extractResourceId(c.req.path);

  const ip        = c.req.header('CF-Connecting-IP')
                 || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim()
                 || null;
  const userAgent = c.req.header('User-Agent')?.slice(0, 512) ?? null;

  adminService.log({
    userId:     user.userId ?? user.id,
    userEmail:  user.email  ?? null,
    action,
    resource,
    resourceId,
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
