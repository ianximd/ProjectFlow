# ProjectFlow - Full-Featured Jira Clone

A complete project management solution built with MS SQL Server, Node.js, and Next.js. Features full Jira parity including Scrum/Kanban boards, sprint management, and automation.

## 🚀 Tech Stack

- **Database**: MS SQL Server 2022 (Stored Procedures only, no ORM)
- **Backend**: Node.js + Hono.js + TypeScript
- **Frontend**: Next.js 14 (App Router) + React + TailwindCSS
- **Real-time**: Socket.io
- **Cache/Queue**: Redis + BullMQ
- **Monorepo**: Turborepo

## 📋 Features

- ✅ Complete issue tracking (Epic, Story, Task, Bug, Sub-task)
- ✅ Scrum & Kanban methodologies
- ✅ Sprint management with burndown charts
- ✅ Drag-and-drop boards with swimlanes
- ✅ Advanced search with PQL (ProjectFlow Query Language)
- ✅ Automation engine with triggers and actions
- ✅ Real-time collaboration
- ✅ Custom workflows
- ✅ Roadmap & timeline views
- ✅ Comprehensive reporting & dashboards
- ✅ File attachments & rich text editing
- ✅ OAuth integration (Google, GitHub, Microsoft)
- ✅ REST API + GraphQL (coming soon)

## 🏗️ Project Structure

```
projectflow/
├── apps/
│   ├── web/              # Next.js frontend
│   └── api/              # Node.js backend
├── packages/
│   ├── types/            # Shared TypeScript types
│   ├── validations/      # Shared Zod schemas
│   ├── utils/            # Shared utilities
│   └── ui/               # Shared UI components
├── infra/
│   ├── docker/           # Dockerfiles
│   ├── k8s/              # Kubernetes manifests
│   ├── terraform/        # Infrastructure as Code
│   └── sql/              # Database migrations & stored procedures
├── docs/                 # Documentation
└── scripts/              # Build & deployment scripts
```

## 🛠️ Development Setup

### Prerequisites

- Node.js >= 20.0.0
- Docker & Docker Compose
- MS SQL Server 2022 (or Docker container)

### Quick Start

1. Clone the repository:
```bash
git clone https://github.com/yourorg/projectflow.git
cd projectflow
```

2. Install dependencies:
```bash
npm install
```

3. Start the database services:
```bash
docker-compose up -d sqlserver redis minio
```

4. Run database migrations:
```bash
npm run db:migrate
npm run db:deploy-sps
npm run db:seed  # Optional: seed with demo data
```

5. Start development servers:
```bash
npm run dev
```

The application will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- API Docs: http://localhost:3001/docs

## 📝 Environment Variables

Copy `.env.example` to `.env` in both `apps/web` and `apps/api` directories and update with your values.

## 🧪 Testing

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Linting
npm run lint
```

## 📦 Building for Production

```bash
# Build all apps
npm run build

# Docker build
docker-compose -f docker-compose.prod.yml build
```

## 🚀 Deployment

The application can be deployed using:
- Docker Compose (single server)
- Kubernetes (scalable)
- Cloud providers (Azure, AWS, GCP)

See `/docs/deployment.md` for detailed deployment instructions.

## 📄 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## 📞 Support

- Documentation: https://docs.projectflow.app
- Issues: https://github.com/yourorg/projectflow/issues
- Discussions: https://github.com/yourorg/projectflow/discussions