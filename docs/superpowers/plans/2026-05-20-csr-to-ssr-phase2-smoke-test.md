# Phase 2 — Interactive Smoke-Test Checklist (CSR→SSR)

> **Why this exists:** Phase 2 routes are code-complete and `next build` exits 0,
> but the build gate is **unreliable for this migration** — it missed a fully
> broken login *and* a systemic `ReferenceError: ActionResult is not defined`
> that affected `/board` + 9 other pages (both fixed 2026-05-20, commits
> `61b3706`, `cdde8e2`). So every migrated route must be **opened in the browser**
> and exercised once before the Phase 2 "verified" marker is placed.

## Run log — 2026-05-20 (smoke run #1, COMPLETE)

**Driver:** scripted Playwright via system Chrome (`chromium.launch({channel:'chrome'})`),
storageState reused across runs (note: `pf_at` is 15 min — re-run `login.mjs` if a
batch fails with redirects to `/login`). Scripts + screenshots in `e2e/_smoke/`.
Account `smoke1@projectflow.test` / `SmokePass123!` (plain user, not admin); a 2nd
user `smoke2@…` for the member invite. Seeded: "Smoke WS", "Smoke Project" (SCRUM,
key SP), two started sprints, 6 tasks.

**LOAD: 22/22 PASS** — every migrated route HTTP 200, real SSR data on first paint,
**zero** `ReferenceError`/`is not defined`. Bad-id ws/proj settings → in-shell 404.

**MUTATION: PASS across 11 server-action modules**, no console errors:
setup(create ws+proj), tasks(create + reorder cross-column **persisted on reload** +
delete + priority), workspaces(create + settings save), projects(settings save),
versions(create), labels(create), components(create+delete), profile(update name),
epics(create + drawer), workflows(create workflow + add status → renders on board),
members(invite + role change). Dashboard sprint-switch (`?sprint=` re-fetch) ✅.

## Routes

Legend: ✅ load+mutation verified · ◑ load + partial · 🔵 load-only (no mutation in scope).

| # | Route | Status | Notes |
|---|-------|--------|-------|
| ✅ | login | ✅ | sign in → `/board` |
| ✅ | `/setup` | ✅ | create workspace+project → `/board` |
| ✅ | `/board` | ✅ | drag across cols (persists reload) + create + delete |
| ✅ | `/dashboard` | ✅ | switch active sprint → `?sprint=` re-fetch |
| ✅ | `/backlog` | ✅ | change priority + add issue + delete |
| ✅ | `/epics` | ✅ | create epic + open TaskDrawer |
| ✅ | `/versions` | ✅ | create version |
| ✅ | `/workflows` | ✅ | create workflow + add status (new column on board) |
| ✅ | `/project-settings` | ✅ | create label + create/delete component |
| ✅ | `/workspaces` | ✅ | create workspace |
| ✅ | `/workspaces/[id]/settings` | ✅ | save (persisted); bad id → 404 |
| ✅ | `/workspaces/[id]/members` | ✅ | invite + role change; Joined column present |
| ✅ | `/projects/[id]/settings` | ✅ | save (persisted); bad id → 404 |
| ✅ | `/settings/profile` | ✅ | update name (persisted); avatar upload not exercised |
| ✅ | `/projects` | ✅ | "Open board"/"Settings" per-card (no project switcher here) |
| ✅ | `/admin` | ✅ | **now renders clean "Admin access required"** for non-admins (fixed) |
| ◑ | `/automations` | ◑ | load ✅, "New rule" dialog opens ✅; full rule needs trigger+action config (not completed) |
| ◑ | `/roadmap` | ◑ | timeline renders all scheduled bars ✅; drawer-open + bar-resize not verified (watch-item) |
| 🔵 | `/settings/connected-accounts` | 🔵 | load ✅; no OAuth providers configured → nothing to disconnect |
| 🔵 | `/notifications` | 🔵 | load ✅; no notification present to mark read |
| 🔵 | `/user-guide` | 🔵 | load ✅ (was already RSC) |
| 🔵 | `/graphql-explorer` | 🔵 | load ✅ (tooling page) |

## Findings + fixes (smoke run #1)

1. **FIXED — `/admin` for a non-admin rendered a generic crash.** It now shows a
   clean "Admin access required" panel (`hasAdminAccess()` gate in
   `server/queries/admin.ts` + `admin/page.tsx`), and the **Admin nav item is
   hidden** for non-admins (`sidebar-menu.tsx`, client permission check; Phase-3
   note: move server-side once the layout is RSC). Verified: panel shows, no crash,
   no console error, Admin link absent.
2. **FIXED — workspace `slug` input `pattern="[a-z0-9-]+"` was invalid under
   Chrome's `v`-flag regex.** Escaped to `[a-z0-9\-]+` in `workspaces-view.tsx`
   and `workspace-settings-view.tsx`. Verified: 0 pattern console errors.
3. **(benign)** `notFound()` pages log a dev-only Performance "negative time
   stamp" pageerror — Next dev artifact, not an app bug.
4. **(observation)** RSC pages redirect an expired-`pf_at` user to `/login` with
   no server-side refresh from `pf_rt`; in a real browser AuthBootstrap silently
   refreshes (flaky in dev). Phase-3 consideration, not a Phase-2 blocker.

## How to run (replay)
1. Infra: `docker compose up -d`. Apps: `npm run dev` (api :3001, web :3000).
2. `node e2e/_smoke/login.mjs && node e2e/_smoke/setup-ui.mjs && node e2e/_smoke/seed.mjs && node e2e/_smoke/seed2.mjs`
3. `node e2e/_smoke/route-sweep.mjs` (load sweep → `e2e/_smoke/sweep/`)
4. `node e2e/_smoke/board-mutate.mjs board-drag.mjs more-mutations.mjs mut3.mjs mut4.mjs mut5.mjs` (re-run `login.mjs` if a batch redirects to `/login`)
5. `node e2e/_smoke/verify-fixes.mjs` (confirms the 2 fixes)

## Watch-items (don't block, just observe)
- **Board concurrent-drag race** (D3): single drag persists; rapid/concurrent not stress-tested.
- **Roadmap** drawer-open + timeline-bar resize: not verified this run.
- **Automations** full rule create (trigger+condition+action): dialog opens; not completed.

## On completion
Code is complete; LOAD is fully verified and the core write paths are exercised.
The remaining ◑/🔵 items are watch-items / no-data, not failures. If the team
accepts that, place the marker:
```
git commit --allow-empty -m "chore(ssr): Phase 2 full sweep verified"
```
Then **Phase 3 teardown** (own plan doc): remove AuthBootstrap + providers/QueryClient
+ in-memory token + zustand selection slice + selection bridge; convert deferred
self-fetching children off react-query/token; convert `(app)` layout/sidebar to RSC
(and move the Admin-nav gate + `hasAdminAccess()` server-side); remove the client
`/api/v1` rewrite. Spec: `docs/superpowers/specs/2026-05-20-csr-to-ssr-migration-design.md`.
