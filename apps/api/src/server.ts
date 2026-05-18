import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { authRoutes } from './modules/auth/auth.routes.js';
import { authMiddleware } from './modules/auth/auth.middleware.js';
import { taskRoutes } from './modules/tasks/task.routes.js';
import { workspaceRoutes } from './modules/workspaces/workspace.routes.js';
import { projectRoutes } from './modules/projects/project.routes.js';
import { sprintRoutes } from './modules/sprints/sprint.routes.js';
import { commentRoutes } from './modules/comments/comment.routes.js';
import { attachmentRoutes } from './modules/attachments/attachment.routes.js';
import { avatarRoutes } from './modules/avatars/avatar.routes.js';
import { notificationRoutes } from './modules/notifications/notification.routes.js';
import { searchRoutes }   from './modules/search/search.routes.js';
import { roadmapRoutes }   from './modules/roadmap/roadmap.routes.js';
import { workflowRoutes }  from './modules/workflows/workflow.routes.js';
import { reportsRoutes }     from './modules/reports/reports.routes.js';
import { automationRoutes }  from './modules/automation/automation.routes.js';
import { startAutomationWorker } from './modules/automation/automation.worker.js';
import { worklogRoutes }     from './modules/worklogs/worklog.routes.js';
import { versionRoutes }     from './modules/versions/version.routes.js';
import { componentRoutes }   from './modules/components/component.routes.js';
import { labelRoutes }       from './modules/labels/label.routes.js';
import { epicRoutes }        from './modules/epics/epic.routes.js';
import { gitRoutes }         from './modules/git/git.routes.js';
import { webhookRoutes }     from './modules/git/webhook.routes.js';
import { integrationRoutes } from './modules/integrations/integration.routes.js';
import { webhookOutgoingRoutes } from './modules/webhooks/webhook-outgoing.routes.js';
import { startOutgoingWebhookWorker } from './modules/webhooks/webhook-outgoing.worker.js';
import { startOAuthMaintenanceWorker } from './modules/auth/oauth/workers/oauth-maintenance.worker.js';
import { requestIdMiddleware } from './shared/middleware/requestId.middleware.js';
import { rateLimiter, authRateLimiter } from './shared/middleware/rateLimiter.middleware.js';
import { auditMiddleware } from './shared/middleware/audit.middleware.js';
import { responseCache } from './shared/middleware/responseCache.middleware.js';
import { securityHeaders } from './shared/middleware/securityHeaders.middleware.js';
import { httpLogMiddleware } from './shared/middleware/httpLog.middleware.js';
import { registerAuditSnapshots } from './shared/middleware/audit-snapshots.bootstrap.js';
import { logger } from './shared/lib/logger.js';
import { runShutdown } from './shared/lib/shutdown.js';
import { isConfigured as oauthCryptoConfigured } from './shared/lib/tokenCrypto.js';
import { getEnabledProviders } from './modules/auth/oauth/registry.js';
import { TTL, cachePing } from './shared/lib/cache.js';
import { getPool } from './shared/lib/db.js';
import { ensureEnvAdminsPromoted } from './shared/lib/envAdminBootstrap.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { ensureBucket } from './shared/lib/storage.js';
import { yoga } from './graphql/yoga.js';

/** Hono context Variables for authenticated routes */
export type Variables = {
  user: { userId: string; email: string; iat?: number; exp?: number } | null;
};

const app = new Hono().basePath('/api/v1');

app.use('*', cors({
  origin: (origin) => {
    const allowed = (process.env.CORS_ORIGIN || 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim());
    return allowed.includes(origin) ? origin : allowed[0];
  },
  credentials: true,
  allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  exposeHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'X-Cache'],
}));

// Global security hardening
app.use('*', securityHeaders);
app.use('*', requestIdMiddleware);
// Structured request log — slot AFTER requestIdMiddleware so each line
// carries X-Request-ID. Tests get suppressed lines because the logger
// defaults to warn-level under NODE_ENV=test.
app.use('*', httpLogMiddleware);
// Rate limiters are skipped in test mode — they target hostile traffic, not
// the rapid-fire request pattern of the integration suite. Dedicated rate-
// limiter tests live in their own file.
if (process.env.NODE_ENV !== 'test') {
  app.use('*', rateLimiter());
}

// Body size guard — reject payloads larger than 4 MB to prevent DoS
app.use('*', async (c, next) => {
  const contentLength = c.req.header('content-length');
  if (contentLength && parseInt(contentLength, 10) > 4 * 1024 * 1024) {
    return c.json(
      { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the 4 MB limit', statusCode: 413 } },
      413,
    );
  }
  await next();
});

app.get('/health', async (c) => {
  const [dbOk, cacheOk] = await Promise.all([
    getPool()
      .then((p) => p.request().query('SELECT 1 AS ok'))
      .then(() => true)
      .catch(() => false),
    cachePing(),
  ]);
  const healthy = dbOk && cacheOk;
  return c.json(
    {
      status:  healthy ? 'ok' : 'degraded',
      db:      dbOk    ? 'connected' : 'error',
      cache:   cacheOk ? 'connected' : 'error',
    },
    healthy ? 200 : 503,
  );
});

// Public routes (auth has its own stricter rate limit)
if (process.env.NODE_ENV !== 'test') {
  app.use('/auth/*', authRateLimiter());
}
app.route('/auth', authRoutes);

// Protected routes
app.use('/tasks/*',      authMiddleware);
app.use('/workspaces/*', authMiddleware);
app.use('/projects/*',   authMiddleware);
app.use('/sprints/*',    authMiddleware);
app.use('/comments/*',       authMiddleware);
app.use('/attachments/*',    authMiddleware);
app.use('/notifications/*',  authMiddleware);
app.use('/search/*',         authMiddleware);
app.use('/roadmap/*',        authMiddleware);
app.use('/workflows/*',      authMiddleware);
app.use('/reports/*',        authMiddleware);
app.use('/automations/*',    authMiddleware);
app.use('/worklogs/*',       authMiddleware);
app.use('/versions/*',       authMiddleware);
app.use('/components/*',     authMiddleware);
app.use('/labels/*',         authMiddleware);
app.use('/epics/*',          authMiddleware);
app.use('/git/*',            authMiddleware);
app.use('/integrations/*',   authMiddleware);
app.use('/outgoing-webhooks/*', authMiddleware);
// incoming git webhooks are public — no authMiddleware
app.use('/admin/*',         authMiddleware);

// Phase 6 W43 — populate the snapshot registry BEFORE the audit middleware
// can ever be invoked. registerAuditSnapshots() is idempotent.
registerAuditSnapshots();

// Audit middleware — fire-and-forget write-op logging on all protected routes
app.use('/tasks/*',       auditMiddleware);
app.use('/projects/*',    auditMiddleware);
app.use('/sprints/*',     auditMiddleware);
app.use('/comments/*',    auditMiddleware);
app.use('/workspaces/*',  auditMiddleware);
app.use('/automations/*', auditMiddleware);
app.use('/workflows/*',   auditMiddleware);
app.use('/worklogs/*',    auditMiddleware);
app.use('/outgoing-webhooks/*', auditMiddleware);

// ── Response cache — hot read-only endpoints ─────────────────────────────────
// Labels, components, versions, epics change infrequently → long TTL
app.use('/labels/*',     responseCache({ ttl: TTL.XLONG }));
app.use('/components/*', responseCache({ ttl: TTL.XLONG }));
app.use('/versions/*',   responseCache({ ttl: TTL.LONG }));
app.use('/epics/*',      responseCache({ ttl: TTL.LONG }));
// Sprint list and roadmap — medium TTL
app.use('/sprints/*',    responseCache({ ttl: TTL.MEDIUM }));
app.use('/roadmap/*',    responseCache({ ttl: TTL.MEDIUM }));
// Workspace + project lists — short TTL (members/projects change regularly)
app.use('/workspaces/*', responseCache({ ttl: TTL.SHORT }));
app.use('/projects/*',   responseCache({ ttl: TTL.SHORT }));
// Admin stats — burst-cache to protect the expensive multi-table count query
app.use('/admin/stats',  responseCache({ ttl: TTL.BURST }));

app.route('/tasks',       taskRoutes);
app.route('/workspaces',  workspaceRoutes);
app.route('/projects',    projectRoutes);
app.route('/sprints',     sprintRoutes);
app.route('/comments',       commentRoutes);
app.route('/attachments',    attachmentRoutes);
// Avatars: GET is public (browser <img> can't carry Bearer tokens); the
// POST/DELETE handlers attach authMiddleware inline.
app.route('/avatars',        avatarRoutes);
app.route('/notifications',  notificationRoutes);
app.route('/search',         searchRoutes);
app.route('/roadmap',        roadmapRoutes);
app.route('/workflows',      workflowRoutes);
app.route('/reports',        reportsRoutes);
app.route('/automations',    automationRoutes);
app.route('/worklogs',       worklogRoutes);
app.route('/versions',       versionRoutes);
app.route('/components',     componentRoutes);
app.route('/labels',         labelRoutes);
app.route('/epics',          epicRoutes);
app.route('/git',            gitRoutes);
app.route('/webhooks',       webhookRoutes);
app.route('/integrations',   integrationRoutes);
app.route('/outgoing-webhooks', webhookOutgoingRoutes);
app.route('/admin',             adminRoutes);

// GraphQL API (Pothos schema + graphql-yoga — handles both queries and SSE subscriptions)
// Auth is handled inside the GraphQL context (JWT-based, per-resolver enforcement)
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore – yoga type cascades from pre-existing schema.ts Pothos errors
app.all('/graphql', async (c) => yoga.handle(c.req.raw, c));

// Boot side-effects (workers, MinIO bucket, env-admin promotion, HTTP
// listener) only run when the process is actually a server. Tests import
// `app` for in-process `app.request()` calls without paying for any of
// this — and without binding port 3001 in vitest workers.
if (process.env.NODE_ENV !== 'test') {
  // Ensure MinIO bucket exists
  ensureBucket().catch((err) => logger.warn({ err: err?.message }, 'MinIO bucket init failed (will retry on first request)'));

  // Promote any users listed in ADMIN_USER_IDS to the super-admin role
  ensureEnvAdminsPromoted().catch((err) =>
    logger.warn({ err: err?.message }, 'env-admin bootstrap failed'),
  );

  // Start automation job worker
  startAutomationWorker();

  // Start outgoing webhook delivery worker
  startOutgoingWebhookWorker();

  // Start OAuth maintenance worker (silent-refresh + key-rotation sweeps).
  // No-op when token encryption isn't configured.
  startOAuthMaintenanceWorker().catch((err) =>
    logger.warn({ err: err?.message }, 'oauth-maintenance worker failed to start'),
  );

  const port = 3001;
  logger.info(
    {
      port,
      nodeEnv:           process.env.NODE_ENV ?? 'development',
      oauthProviders:    getEnabledProviders().map((p) => p.name),
      oauthCrypto:       oauthCryptoConfigured() ? 'on' : 'off',
      workers:           ['automation', 'outgoing-webhook', oauthCryptoConfigured() && 'oauth-maintenance'].filter(Boolean),
    },
    `API server listening on :${port}`,
  );

  serve({
    fetch: app.fetch,
    port,
  });

  const onSignal = (signal: NodeJS.Signals) => {
    runShutdown(signal).finally(() => process.exit(0));
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT',  onSignal);
}

export { app };
