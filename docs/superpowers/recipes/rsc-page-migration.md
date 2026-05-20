# Recipe: Migrate a CSR page to the RSC server-first pattern

Derived from the Phase 1 Projects slice (`apps/next-web/src/app/(app)/projects/`).

## Steps
1. **DAL query** in `src/server/queries/<domain>.ts` — `cache()`-wrapped, `import 'server-only'`,
   calls `serverFetch`, maps rows through a pure `normalize<X>()` in `queries/normalize.ts`.
   Unit-test the normalizer (pure); the query wrapper is covered by E2E.
2. **Server Actions** in `src/server/actions/<domain>.ts` — `'use server'`, `requireSession()`,
   `serverFetch(...)`, `revalidatePath('/<route>')`, return `ActionResult`. Guard `catch` with
   `unstable_rethrow(e)` so `redirect()` propagates.
3. **page.tsx** → `async` Server Component: `requireSession()`, read `getSelection()` if the page is
   workspace/project-scoped, fetch via DAL (`Promise.all` for parallel reads), render `<XView ... />`.
   Validate cookie selection against fetched lists; `redirect('/setup')` on empty.
4. **<x>-view.tsx** → `'use client'`: existing UI, data via props, mutations via actions +
   `useTransition`, errors via return value (inline) or `notifyApiError` (toast). No react-query,
   no in-memory token, no client `/api/v1` fetch.
5. **loading.tsx** → skeleton (move the old in-component skeleton here).
6. **Selection bridge** (only on pages with the workspace/project switcher, until Phase 3):
   mirror switches into zustand `setCurrentWorkspace`/`setCurrentProject` and seed the cookie from
   the legacy value on first visit, so non-migrated pages stay consistent.

## Gotchas
- Next 16: `cookies()` is async; cookies can only be **set** in actions/route handlers, not in render.
- A Server Component page renders fine under the still-client `(app)` layout (RSC composition).
- `serverFetch` redirects on 401 — never swallow that in an action catch (`unstable_rethrow`).
- Verify first paint via view-source, and that mutations reflect without a manual reload.

## Phase 2 order
Read-heavy pages first (dashboard, epics, roadmap, backlog, workspaces, versions, workflows,
notifications, automations, settings, setup, user-guide, graphql-explorer). **Board last**
(drag-drop optimistic reorder via Server Action + `useOptimistic`).
