# ProjectFlow

**ProjectFlow** is an open-source project management platform built for software teams — think Jira, but self-hostable, fast, and yours to own.

> Version **1.0.0** — released May 2026

## Features

- **Kanban & Sprint Boards** — drag-and-drop issue management with customisable workflows
- **Backlog & Epic Planning** — hierarchical backlog with roadmap / Gantt timeline
- **Sprint Management** — start/complete sprints, burndown charts, velocity reports
- **Advanced Search (PQL)** — ProjectFlow Query Language for powerful filtered views
- **Automation Engine** — trigger → condition → action rules (BullMQ-powered)
- **Time Tracking** — work logs with per-sprint time roll-ups
- **Comments** — rich text (TipTap), @mentions, emoji reactions
- **File Attachments** — S3 / MinIO with 15-minute signed URLs
- **Real-time Notifications** — WebSocket in-app + email (BullMQ)
- **Git Integration** — GitHub / GitLab PR and commit linking
- **Slack & Teams Integration** — channel notifications
- **GraphQL API** — Pothos schema builder on top of the REST v1 layer
- **Admin Panel** — user management, audit log, workspace stats
- **WCAG 2.1 AA** — keyboard navigation, skip links, ARIA landmarks, reduced-motion

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TanStack Query, CSS Modules, Zustand |
| Backend | Hono.js 4, Node.js 20, TypeScript 5 |
| Database | MS SQL Server 2022 — 100% Stored Procedure access |
| Cache | Redis 7 (ioredis) — response cache + distributed rate-limiting |
| Queue | BullMQ — automation worker + outgoing webhook delivery |
| Storage | MinIO / Azure Blob Storage |
| Monorepo | Turborepo |

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 20+
- pnpm (or npm)

### 1. Start infrastructure

```bash
docker compose up -d
```

This starts SQL Server 2022, Redis 7, and MinIO.

### 2. Configure environment

```bash
cp apps/api/.env.example      apps/api/.env
cp apps/next-web/.env.example apps/next-web/.env.local
```

Edit both files and set your secrets (see comments in each file).

### 3. Run database migrations

```bash
npm run db:migrate
```

### 4. Deploy stored procedures

```bash
npm run db:deploy-sps
```

### 5. Install dependencies and start dev servers

```bash
npm install
npm run dev
```

- **API**: http://localhost:3001
- **Web**: http://localhost:3000
- **MinIO Console**: http://localhost:9001

## Project Structure

```
.
├── apps/
│   ├── api/          Hono.js REST + GraphQL backend
│   └── next-web/     Next.js 14 frontend
├── packages/
│   ├── types/        Shared TypeScript interfaces
│   ├── validations/  Shared Zod schemas
│   └── utils/        Shared utilities
├── infra/
│   └── sql/
│       ├── migrations/   Numbered SQL migration files
│       ├── procedures/   Stored procedure definitions (CREATE OR ALTER)
│       └── seeds/        Development seed data
├── scripts/
│   ├── db-migrate.ts     Migration runner
│   └── db-deploy-sps.ts  Idempotent SP deployer
└── docker-compose.yml
```

## Database Migrations

Migrations are numbered SQL files in `infra/sql/migrations/`. Run them in order:

```bash
npm run db:migrate
```

## API Documentation

The REST API is versioned at `/api/v1`. All endpoints require a Bearer token except `/api/v1/auth/*`.

Key endpoints:

| Resource | Base path |
|---|---|
| Authentication | `/api/v1/auth` |
| Workspaces | `/api/v1/workspaces` |
| Projects | `/api/v1/projects` |
| Tasks / Issues | `/api/v1/tasks` |
| Sprints | `/api/v1/sprints` |
| Comments | `/api/v1/comments` |
| GraphQL | `/api/v1/graphql` |

## Environment Variables

See `apps/api/.env.example` and `apps/next-web/.env.example` for the full list with descriptions.

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit with [Conventional Commits](https://www.conventionalcommits.org/)
4. Open a pull request

## License

MIT © ProjectFlow Contributors

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
