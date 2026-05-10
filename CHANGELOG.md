# Changelog

All notable changes to ProjectFlow are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [1.0.0] — 2026-05-08

### Added

#### Phase 1 — Foundation (Weeks 1–6)
- Turborepo monorepo with `apps/api` (Hono.js) and `apps/next-web` (Next.js 14)
- Docker Compose stack: MS SQL Server 2022, Redis 7, MinIO
- GitHub Actions CI pipeline (lint, build, test)
- Numbered SQL migration runner (`scripts/db-migrate.ts`)
- Idempotent stored-procedure deployer (`scripts/db-deploy-sps.ts`)
- Authentication: register, login, JWT (15 min access / 7 day refresh), OAuth skeleton
- Stored procedures: `usp_User_*`, `usp_RefreshToken_*`, `usp_PasswordReset_*`
- Workspace & Project CRUD + member management (`usp_Workspace_*`, `usp_Project_*`, `usp_WorkspaceMember_Add`)
- Task / Issue CRUD with custom workflow statuses (`usp_Task_*`, `usp_Task_Transition`)
- Kanban Board UI — static columns, drag-and-drop via @dnd-kit
- Backlog view + Sprint creation (`usp_Sprint_Create`, `usp_Sprint_Start`)

#### Phase 2 — Core Features (Weeks 7–14)
- Sprint start/complete with burndown chart (`usp_Sprint_Complete`, `usp_Report_Burndown`)
- Comments: TipTap rich text, @mentions, emoji reactions (`usp_Comment_*`)
- File attachments via MinIO / Azure Blob with signed URLs (`usp_Attachment_*`)
- In-app WebSocket notifications + email delivery via BullMQ (`usp_Notification_*`)
- Advanced search: PQL (ProjectFlow Query Language) parser + `usp_Task_Search_PQL`
- Roadmap / Timeline Gantt view (`usp_Roadmap_GetItems`)
- Custom workflow editor with transition validation SPs (`usp_Workflow_*`)
- Dashboards: velocity, workload, created-vs-resolved, sprint summary reports (`usp_Report_*`)

#### Phase 3 — Advanced Features (Weeks 15–22)
- Automation engine: trigger → condition → action processor via BullMQ (`usp_AutomationRule_*`)
- Time tracking: work logs with per-sprint roll-ups (`usp_WorkLog_*`)
- Versions, Epics, Components, Labels with full SP coverage
- GitHub / GitLab integration: webhooks, PR + commit linking (`usp_GitPR_*`, `usp_GitCommit_*`)
- Slack + Microsoft Teams integration for channel notifications
- Outgoing webhooks with delivery queue, retry logic, HMAC-SHA256 signatures
- GraphQL API via Pothos schema builder and graphql-yoga (`/api/v1/graphql`)
- Admin panel: user management, workspace stats, full audit log viewer (`usp_Admin_*`, `usp_AuditLog_*`)

#### Phase 4 — Polish & Launch (Weeks 23–26)
- **Week 23** — Mobile responsive layout + WCAG 2.1 AA accessibility
  - Skip links, `aria-current`, `aria-expanded`, `role="tabpanel"` pattern throughout
  - Off-canvas hamburger sidebar for ≤768 px viewports
  - `prefers-reduced-motion` and `pointer: coarse` (44 px touch targets) media queries
  - Board and Column components annotated with ARIA list roles and labels
- **Week 24** — Performance: Redis cache expansion + SP execution plan tuning
  - `cache.ts`: ioredis singleton with `withCache`, `TTL`, `CacheKey` helpers; graceful fallback when Redis is unreachable
  - `responseCache` middleware: caches 2xx GET responses with `X-Cache: HIT/MISS` headers
  - Response cache applied to labels (15 min), components (15 min), versions/epics (5 min), sprints/roadmap (2 min), workspaces/projects (30 s), admin stats (5 s)
  - Rate-limiter upgraded from in-memory Map to Redis INCR + EXPIRE with in-memory fallback
  - DB connection pool tuned: `max` 20→50, `min` 2→5, `acquireTimeoutMillis`, `connectionTimeout`
  - `trackQueryTime()` logs slow SPs (>500 ms) to stderr
  - Migration 0016: 11 covering non-clustered indexes on Tasks, Comments, Notifications, WorkspaceMember, Project, Sprint, WorkLog, RoadmapItem + `UPDATE STATISTICS … WITH FULLSCAN`
- **Week 25** — Security audit + fix cycle (OWASP Top 10)
  - `securityHeaders` middleware: CSP, HSTS (production), X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, COEP, CORP
  - `X-Powered-By` and `Server` headers removed to prevent fingerprinting
  - CORS upgraded to whitelist-array origin validation with `exposeHeaders`
  - Body-size guard: 413 for payloads >4 MB
  - bcrypt cost factor raised from 10 → **12**
  - `JWT_SECRET` validated at startup — throws in production if missing or using default value
  - Account lockout: 5 consecutive failed logins → 15-minute lock (migration 0017, `usp_User_RecordFailedLogin`, `usp_User_ClearLoginAttempts`)
  - Refresh token cookie hardened: `SameSite=Strict`
- **Week 26** — Docs site, public launch, v1.0.0
  - Root `README.md` rewritten for public launch
  - `.env.example` files for API and Next.js app
  - TypeScript migration runner (`scripts/db-migrate.ts`)
  - TypeScript SP deployer (`scripts/db-deploy-sps.ts`) replacing the `.bat` script
  - GitHub Actions CI (`ci.yml`) and production deploy (`deploy-prod.yml`) workflows
  - This CHANGELOG

### Security

- All database access via parameterised Stored Procedures — SQL injection architecturally prevented
- JWT access tokens (15 min) + httpOnly/Secure/SameSite=Strict refresh cookies (7 days, rotated on use)
- Password reset tokens: SHA-256 hashed, 1-hour expiry, single-use
- Account lockout after 5 failed logins (15-minute lockout)
- TLS 1.3 enforced; SQL Server `encrypt=true`
- Signed MinIO URLs with 15-minute expiry
- Sensitive fields (`PasswordHash`, `MfaSecret`) never returned in API responses
- Full audit log for all write operations
- HMAC-SHA256 signatures on all outgoing webhooks

[1.0.0]: https://github.com/your-org/projectflow/releases/tag/v1.0.0
