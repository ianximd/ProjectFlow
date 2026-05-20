# CSR → SSR Migration Design — ProjectFlow `next-web`

**Date:** 2026-05-20
**Status:** Approved (design) — pending spec review
**Author:** brainstorming session
**Scope:** `apps/next-web` (Next.js 16 App Router) + targeted auth changes in `apps/api`

---

## 1. Goal

Move `next-web` from a client-side-rendered SPA shell to a **server-first** app where pages
fetch their data in **React Server Components (RSC)** and render populated HTML on the server.

This eliminates the current "refresh-token → then fetch data" double round-trip and the
full-screen auth loader, reduces client JS, and removes data-fetching waterfalls.

### Decided constraints (from brainstorming)

| Decision | Choice |
|----------|--------|
| Primary goal | Server-fetch data in components (RSC) |
| Auth foundation | Next.js **BFF session** (httpOnly cookies the server can read) |
| Migration scope | **Big-bang** full migration, foundation-first with one vertical slice to de-risk |
| Client data layer | **Server Actions + revalidate** (remove react-query entirely) |
| Backend changes | **Allowed** |
| Token refresh location | **Proxy (`proxy.ts`)** as the single per-request refresh chokepoint |
| Workspace/project selection | Stored in a **cookie**, set via a Server Action |
| Session cookie contents | Backend access JWT + refresh token stored **directly** as httpOnly cookies (encryption deferred) |

---

## 2. Current architecture (baseline)

- **Next.js 16.2.5 / React 19.2.4**, App Router. NOTE: Next 16 renames Middleware → **Proxy**;
  `cookies()` is **async**; `fetch` is **not cached by default**; cookies can only be **set** in
  Server Actions / Route Handlers (not during render).
- **Effectively CSR:** 76 files carry `'use client'`, including every page and the `(app)` layout.
- **Auth:** access token (JWT) held **in memory only** in a zustand store; refresh token is an
  httpOnly cookie scoped to **`path=/api/v1/auth`**, `sameSite=Strict`, 7-day, **rotating**
  (every `/auth/refresh` issues a new refresh token + access token). The access token is **only**
  returned in the response body, never as a cookie. On every reload, `(app)/auth-bootstrap.tsx`
  calls `/auth/refresh` client-side and shows `ScreenLoader` until the token is restored.
- **Data fetching:** client-side via `@tanstack/react-query` + per-page inlined `fetch('/api/v1/...')`
  helpers sending `Authorization: Bearer <in-memory token>`.
- **Backend:** separate Hono API at `:3001`; the browser reaches it through a Next `rewrites()`
  proxy (`/api/v1/:path*` → backend), so cookies live on the `localhost:3000` (Next) origin.
- **Selection state:** `currentWorkspaceId` / `currentProjectId` / roadmap viewport persisted in
  `localStorage` (client-only, invisible to the server).
- **No** websockets / SSE / polling anywhere — the app is pure request/response.
- **No** existing `middleware.ts` / `proxy.ts`.

---

## 3. Target architecture

```
Browser
   │  (httpOnly cookies: pf_at, pf_rt, pf_sel — path "/")
   ▼
Next.js server  ── proxy.ts (refresh chokepoint + optimistic auth redirect)
   │             ── DAL  (src/server/session.ts, src/server/api.ts, src/server/queries/*)
   │             ── Server Actions (src/server/actions/*)
   ▼  (server-to-server, Bearer from cookie)
apps/api  (:3001)
```

### 3.1 Session cookies (Next origin, `path=/`)

| Cookie | Contents | Flags |
|--------|----------|-------|
| `pf_at` | backend access JWT | httpOnly, secure(prod), sameSite=Lax, short maxAge (~ token TTL) |
| `pf_rt` | backend refresh token (opaque) | httpOnly, secure(prod), sameSite=Lax, 7-day |
| `pf_sel` | JSON `{ workspaceId, projectId }` | httpOnly, secure(prod), sameSite=Lax, long-lived |

`sameSite=Lax` (not `Strict`) so the cookies are sent on top-level navigations and the OAuth
redirect return. Roadmap viewport (`roadmapZoom`, `roadmapScrollLeft`) stays **client-only** — it
is pure UI state with no server relevance and remains in zustand/localStorage.

### 3.2 Proxy — `apps/next-web/src/proxy.ts`

Single per-request chokepoint. On matched routes:

1. Read `pf_at` and `pf_rt`.
2. If `pf_at` is missing/expired (decode `exp`, treat near-expiry as expired) **and** `pf_rt`
   exists → call backend `POST /api/v1/auth/refresh` server-to-server with the refresh token;
   on success, set rotated `pf_at` + `pf_rt` on the response and continue with the new access
   token; on failure, clear cookies.
3. **Optimistic redirects only:** unauthenticated request to a protected route → redirect
   `/login`; authenticated request to `/login`,`/register`,`/` → redirect `/board`.
4. Real authorization is **not** done here — it lives in the DAL + backend (per Next guidance).

`matcher` excludes `/_next/*`, static assets, and Next route handlers under `/api/auth/*`.
Because refresh happens once per navigation here, there are no intra-request rotation races.

### 3.3 Data Access Layer (DAL) — `apps/next-web/src/server/`

- `session.ts`
  - `getSession()` — `cache()`-wrapped; reads `pf_at`, decodes the JWT → `{ userId, email, … }`
    or `null`. Deduped per render pass.
  - `requireSession()` — `getSession()` or `redirect('/login')`.
- `api.ts`
  - `serverFetch(path, init?)` — `import 'server-only'`; attaches `Authorization: Bearer <pf_at>`,
    calls `${API_URL}${path}` server-to-server, returns parsed JSON. On `401` (token revoked
    mid-flight — rare since proxy pre-refreshes) → `redirect('/login')`. Default uncached
    (request-time). Optional `revalidate`/`tags` for cacheable reads.
- `queries/*.ts` — typed read helpers per domain (`getProjects(workspaceId)`,
  `getBoard(projectId)`, `getEpics(projectId)`, …), each `cache()`-wrapped. These replace the
  per-page inlined `api()` helpers and centralize the PascalCase/camelCase normalization that is
  currently duplicated across pages.
- `selection.ts` — `getSelection()` reads `pf_sel`; `setSelection()` (Server Action) writes it.

### 3.4 Server Actions — `apps/next-web/src/server/actions/`

All mutations move here, grouped by domain (`auth.ts`, `projects.ts`, `board.ts`, `epics.ts`,
`workspaces.ts`, `settings.ts`, `admin.ts`, …). Each action:

1. `'use server'`
2. `requireSession()` (defense in depth; backend still enforces).
3. `serverFetch(...)` the mutation.
4. `revalidatePath(...)` / `revalidateTag(...)` (or `refresh()` for the current route).
5. Return a typed result for `useActionState` / inline error handling.

Auth actions (`login`, `register`, `logout`, `mfaChallenge`, `setSelection`) set/clear cookies via
the async `cookies()` API (allowed inside actions).

### 3.5 Page pattern (Server shell + Client view)

Each route becomes:

- `page.tsx` — `async` Server Component: `requireSession()`, read `getSelection()`, fetch via
  DAL queries (`Promise.all` for parallel), render a `*-view.tsx` with data as props. A
  `loading.tsx` (or `<Suspense>`) provides the skeleton that the per-page `Skeleton` components
  render today.
- `*-view.tsx` — `'use client'`: interactivity only (dialogs, filters, drag-drop). Receives
  server data as props; calls Server Actions for mutations; uses `useActionState` /
  `useTransition` for pending state. **No react-query, no in-memory token, no client `/api/v1`
  fetches.**

### 3.6 Removals

- `apps/next-web/src/app/(app)/auth-bootstrap.tsx` and the mandatory `ScreenLoader` gate.
- The in-memory `accessToken` / `setAuth` / `clearAuth` path in `useStore.ts` (auth leaves zustand;
  selection moves to cookie; only roadmap viewport UI state remains client-side).
- `@tanstack/react-query` usage, `providers.tsx` QueryClient, and every `useQuery`/`useMutation` call.
- The `/api/v1/:path*` **client** rewrite is retained only if a residual client→backend call
  remains; the goal is zero direct client→`/api/v1` calls (all go through Server Actions / route
  handlers, which carry the cookie token server-side).

---

## 4. Auth flows (target)

### 4.1 Email/password login
1. `/login` client form → `login` Server Action.
2. Action calls backend `POST /api/v1/auth/login` server-to-server.
3. Backend returns `{ user, token (access JWT), refreshToken }` **in the body** for the trusted
   server caller (backend change — see §5).
4. Action sets `pf_at` + `pf_rt` cookies, then `redirect('/board')`.
5. MFA: if backend returns `mfaRequired`, action returns that state; `/oauth/mfa` (or an inline
   step) collects the code and calls a `mfaChallenge` action that finalizes cookies.

### 4.2 Refresh
Handled in `proxy.ts` (§3.2). Backend rotation already returns a new pair; proxy persists it.

### 4.3 Logout
`logout` Server Action → backend `POST /api/v1/auth/logout` (revoke) → delete `pf_at`,`pf_rt`,`pf_sel`
→ `redirect('/login')`.

### 4.4 OAuth
Backend callback currently sets the refresh cookie at `/api/v1/auth` and redirects to the SPA
`/oauth/finish`, which calls `/auth/refresh` client-side. Target: the backend callback redirects to
a **Next route handler** `GET /api/auth/oauth/finish` carrying a **one-time code**; the handler
exchanges the code with the backend for `{ token, refreshToken }`, sets `pf_at`/`pf_rt`, and
redirects to `returnTo`. The `mfa-required` and `error` branches redirect to the existing
`/oauth/mfa` / `/oauth/error` pages. (Backend change — see §5.)

---

## 5. Backend changes (`apps/api`)

1. **Return the refresh token to the trusted Next server.** For `POST /auth/login` and
   `POST /auth/mfa/challenge`, include `refreshToken` in the response body when the request is
   server-to-server (gate behind a shared `X-BFF-Secret` header set only by the Next server, so
   browsers never receive it). Keep the existing cookie-setting behavior for backward compatibility
   during migration, or remove it once the BFF is the only caller.
2. **OAuth finish via one-time code.** Add an endpoint the Next route handler can call to exchange
   a short-lived one-time code (minted by the callback) for `{ token, refreshToken }`; redirect the
   callback to the Next handler instead of `/oauth/finish`.
3. **Refresh-rotation grace window.** Allow a brief reuse window (or last-rotated-token grace) so
   two tabs refreshing near-simultaneously don't invalidate each other. Document the chosen
   tolerance in the auth service.
4. **CORS / origin:** confirm server-to-server calls from the Next server origin are accepted; the
   `X-BFF-Secret` gate must be required for any refresh-token-in-body response.

All backend changes are additive/guarded to avoid breaking the app mid-migration.

---

## 6. Page inventory (big-bang sweep targets)

**Protected `(app)` routes (Server shell + Client view):** `dashboard`, `board`, `backlog`,
`epics`, `roadmap`, `projects`, `projects/[id]/settings`, `project-settings`, `workspaces`,
`workspaces/[id]/members`, `workspaces/[id]/settings`, `workflows`, `versions`, `automations`,
`notifications`, `admin`, `setup`, `user-guide`, `settings/profile`, `settings/connected-accounts`,
`graphql-explorer`.

**Public/auth routes:** `/` (landing/redirect), `login`, `register`, `oauth/finish`, `oauth/mfa`,
`oauth/error`.

**Shared client components needing rework** (drop react-query / in-memory token, accept props +
call actions): `Board.tsx`, `Column.tsx`, `TaskCard.tsx`, `TaskDrawer.tsx`, `GanttChart.tsx`,
`CommentSection.tsx`, `AttachmentSection.tsx`, `WorkLogSection.tsx`, `PullRequestsSection.tsx`,
`WebhookManager.tsx`, charts (`*Chart.tsx`, `SprintSummaryWidget.tsx`), admin (`RolesTab.tsx`,
`RoleEditorDialog.tsx`, `PermissionPicker.tsx`), settings integrations
(`GitIntegrationSettings.tsx`, `SlackTeamsSettings.tsx`), `layouts/layout-1/*`,
`sidebar-menu.tsx`. Pure UI primitives under `components/ui/*` stay as-is.

---

## 7. Build order (foundation-first, then sweep)

**Phase 0 — Foundation (no page behavior change yet)**
- Backend: refresh-token-in-body (guarded), OAuth one-time-code endpoint, rotation grace.
- Next: `proxy.ts`, `src/server/{session,api,selection}.ts`, auth Server Actions, `/api/auth/*`
  route handlers, cookie helpers. Wire `login`/`logout`/OAuth to cookies. Remove `AuthBootstrap`
  gate. App still renders (pages temporarily read session via DAL but keep existing client fetch as
  fallback only where not yet migrated).

**Phase 1 — Vertical slice (prove the pattern)**
- Migrate **Projects** (representative: list read + create/archive/delete mutations + workspace
  selection cookie) fully to Server shell + Server Actions + revalidate. Lock the pattern, write
  tests, document the recipe.

**Phase 2 — Sweep**
- Convert remaining read-heavy pages (dashboard, epics, roadmap, backlog, workspaces, versions,
  workflows, notifications, admin, settings, setup, user-guide, graphql-explorer) using the slice
  recipe.
- Convert the **Board** last (drag-drop optimistic reorder via Server Action + `useOptimistic`;
  highest risk).

**Phase 3 — Teardown**
- Remove react-query, `providers.tsx` QueryClient, in-memory auth from `useStore.ts`, dead client
  `api()` helpers, and the client `/api/v1` rewrite if unused.

Each phase ends green (typecheck + build + tests) before the next.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Cookies can't be set during RSC render | All token writes happen in proxy / Server Actions / route handlers only. |
| Rotating refresh token races across tabs | Single refresh in proxy + backend grace window. |
| Board drag-drop UX regresses without react-query optimistic updates | Use React `useOptimistic` + Server Action; migrate Board last with focused tests. |
| Direct client→`/api/v1` calls lose the Bearer (now httpOnly) | Route every client call through Server Actions / route handlers; audit grep for `fetch('/api/v1` in client files. |
| File uploads (`AttachmentSection`) need the token | Move upload through a route handler that injects the cookie token server-side. |
| Big-bang regressions across 76 client files | Foundation + vertical slice first; phase gates with build+tests; convert Board last. |
| Refresh-token-in-body leaking to browsers | Gate behind `X-BFF-Secret`; never expose on browser-originated requests. |
| `next/font` Inter currently fetched at build — unaffected | No change needed. |

---

## 9. Testing strategy

- **Unit:** DAL (`getSession` decode/expiry, `serverFetch` 401 redirect), proxy refresh decision
  logic, selection cookie read/write, normalization helpers.
- **Integration (backend):** refresh-token-in-body gating, OAuth one-time-code exchange, rotation
  grace window.
- **Page-level:** Server Component renders with a mocked DAL; Client view renders with props and
  invokes actions (mocked).
- **E2E (manual + scripted):** login → board populated on first paint (view-source shows data),
  reload keeps session (no loader flash), workspace switch re-fetches server-side, logout clears
  cookies, OAuth round-trip, MFA, Board drag-drop persists.
- Phase gate: `next build` + `vitest run` + `eslint` green per phase.

---

## 10. Out of scope

- SEO/metadata work for public pages (separate effort if wanted).
- Encrypting session cookies with iron-session/jose (deferred; can layer on later).
- Partial Prerendering / `use cache` / `cacheComponents` tuning (can follow once dynamic SSR is
  stable).
- Real-time/live updates (none today; not introduced here).
- Roadmap viewport persistence change (stays client-side).

---

## 11. Open questions for spec review

1. MFA UX: keep the dedicated `/oauth/mfa` page, or inline the second step into `/login`?
2. Selection cookie: confirm httpOnly (server-only) is acceptable, vs readable so client code can
   display the current selection without a prop. (Plan: pass selection from server as props →
   httpOnly is fine.)
3. Backend: prefer refresh-token-in-body gated by `X-BFF-Secret`, or a dedicated
   `/auth/session-exchange` server-to-server endpoint? (Plan: header-gated body field.)
