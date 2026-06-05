# End-to-end tests (Playwright)

The specs in this directory drive the **real** app: Playwright auto-starts the API
(`:3001`) and Next.js web (`:3000`) dev servers (see [`playwright.config.ts`](../playwright.config.ts)),
seeds data over the live REST + GraphQL API, and asserts through the browser UI.

## Pointing the run at a local test database

`apps/api/.env` is committed pointing at a **remote** database. E2E tests create
and mutate real rows, so they **must never** run against it. Instead, target the
local Docker SQL Server (`docker-compose.yml`) and a dedicated `ProjectFlow_Test`
database.

Node's `--env-file` does **not** override variables already present in the
environment, so exporting the `DB_*` vars in the shell that launches Playwright
cleanly redirects both the migration scripts and the auto-started API server at
the local DB — without editing the committed `.env`.

### One-time: migrate the test DB

```powershell
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'
$env:DB_USER='sa'; $env:DB_PASSWORD='YourStrong@Passw0rd'
$env:DB_ENCRYPT='false'; $env:DB_TRUST_SERVER_CERTIFICATE='true'
npm run db:migrate
npm run db:deploy-sps
```

### Run the suite

```powershell
$env:DB_SERVER='localhost'; $env:DB_PORT='1433'; $env:DB_NAME='ProjectFlow_Test'
$env:DB_USER='sa'; $env:DB_PASSWORD='YourStrong@Passw0rd'
$env:DB_ENCRYPT='false'; $env:DB_TRUST_SERVER_CERTIFICATE='true'
$env:REDIS_URL='redis://localhost:6379'
npx playwright test            # or: npx playwright test e2e/views.spec.ts
```

Requires the local stack (SQL Server + Redis) up: `docker compose up -d`.
The Playwright `globalSetup` flushes Redis rate-limit keys so the auth limiter
doesn't 429 the seed register/login calls.

### A note on hydration timing

These specs run dev-mode servers, so the very first navigation pays an on-demand
route compile. A real DOM click can land before React hydration wires up an
`onClick`, so interactions that toggle client state (e.g. the filter-builder
panel) retry until the state actually flips — and server-action writes are
awaited (via the action's POST round-trip) before a reload reads them back. See
`openFilterBuilder` / the save step in [`views.spec.ts`](./views.spec.ts).
