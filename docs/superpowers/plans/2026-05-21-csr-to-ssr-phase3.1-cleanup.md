# CSR→SSR Migration — Phase 3.1 (Cleanup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three loose ends the Phase 3 teardown left open — fully retire the legacy zustand selection bridge (drive the switcher + drawer off the `pf_sel` cookie / server props alone), fix the pre-existing date-locale hydration mismatch on `/projects` + `/roadmap`, and runtime-verify the two account-gated surfaces (OAuth login, admin-roles CRUD).

**Architecture:** This is polish, not migration — the CSR→SSR migration itself is complete and merged (`main` tip `67605b7`). Three independent batches: **L** removes the `useSelectionBridge` zustand mirror in dependency order (drop the only non-bridge reader first, then the writer, then the hook, then the store slice); **M** introduces a fixed-locale date helper so server (Node, en-US) and client (browser, id-ID) format identically; **N** is verification-only (no code) for surfaces that were written + reviewed + statically green in Phase 3 but never exercised live.

**Tech Stack:** Next.js 16 (App Router, async `cookies()`), React 19 (`useTransition`), Server Actions, zustand (client UI state only), `Intl.DateTimeFormat`, vitest. The cookie/server selection truth is `WorkspaceProjectContext` (`src/server/context.ts`) → `setSelection` action (`src/server/actions/selection.ts`).

> ⚠️ **Next 16 caveat (`apps/next-web/AGENTS.md`):** "This is NOT the Next.js you know." Before touching any Next API, check `node_modules/next/dist/docs/`. (Phase 3.1 touches no Next APIs directly, but the rule stands.)

---

## Why each item is in scope (and what is NOT)

- **L — selection bridge:** Phase 3 spec §3.6 wanted selection consolidated to the cookie. The `pf_sel` cookie *is* the source of truth (server → `ctx.activeWorkspaceId`), but `useSelectionBridge` still mirrors it into the zustand store, and that mirror is read by `TaskDrawer`'s `workspaceId` fallback. The Phase 3 plan said "remove the selection bridge only if dead" (Task K3) — it wasn't dead, so it stayed. It is small and safe to retire now: there is exactly **one** non-bridge reader of the zustand selection slice.
- **M — date-locale hydration mismatch:** Pre-existing bug, not migration scope. `toLocaleDateString(undefined)` / `Intl.DateTimeFormat(undefined)` resolves to en-US on the Node server and id-ID in the browser → React hydration warning on `/projects` and `/roadmap`. Benign (the client re-renders) but worth fixing with a fixed locale.
- **N — verification gaps:** OAuth login (needs real provider creds) and admin-roles CRUD (needs an admin account; the smoke user is intentionally non-admin). Code is written, reviewed, and statically green — only the runtime exercise is missing.

**Explicitly out of scope:** there is no Phase 4. Nothing in this plan changes the migration's architecture; if any task balloons, stop and re-plan rather than expanding scope.

---

## Per-batch gate (reuse the Phase 3 gate — build-green ≠ correct)

Batches **L** and **M** end with the full gate. Batch **N** is runtime verification only.

- `pnpm --filter next-web exec tsc --noEmit` → exit 0
- `pnpm --filter next-web exec vitest run` → all pass
- `pnpm --filter next-web build` → exit 0
- **Two-stage code review** (superpowers:requesting-code-review) for any batch that changed code.
- **Interactive smoke** of the touched surface in a running app.

> Confirm the runner in Task P1 before running any gate command; replace `pnpm --filter next-web` with the repo's actual form if it differs.

**TDD calibration:** Batch L is a pure refactor whose behavior (workspace/project switch re-renders server data; drawer member picker still loads) is integration-level — Phase 2/3 proved unit-green ≠ correct, so its gate is tsc/build + review + **live smoke**, not new unit tests. Batch M extracts a pure formatter with a deterministic output — that one is **test-first**.

---

## Preflight (Batch P) — branch + baseline

### Task P1: Branch from a green `main` and confirm the runner

**Files:** none (git + verification only)

- [ ] **Step 1: Confirm a clean tree on `main` at the post-Phase-3 tip**

Run: `git -C d:/Project/ProjectFlow/ProjectFlow status --short` → expect clean (plus this new plan file).
Run: `git -C d:/Project/ProjectFlow/ProjectFlow log --oneline -1` → expect `67605b7` (or later) — Phase 3 teardown merged.

- [ ] **Step 2: Confirm the workspace runner** (so every gate command below is correct)

Run: `cat apps/next-web/package.json` and the root `package.json` `scripts`. Confirm `pnpm --filter next-web` is the right invocation (Phase 3 used it). Use the confirmed form in all gate steps.

- [ ] **Step 3: Create the Phase 3.1 branch**

```bash
git switch -c feat/csr-to-ssr-phase3.1-cleanup
```

### Task P2: Capture the selection-slice burn-down baseline (the objective gate for L4)

**Files:** none (read-only measurement)

- [ ] **Step 1: Record the starting reader count** — must reach "only `useStore.ts` defines it; nothing reads it" before L4 deletes the slice.

Run (from repo root):
```bash
git grep -n "currentWorkspaceId\|currentProjectId\|setCurrentWorkspace\|setCurrentProject" -- apps/next-web/src
git grep -n "useSelectionBridge" -- apps/next-web/src
```
Expected baseline (2026-05-21):
- Selection-slice refs in **3** source files: `store/useStore.ts` (definition), `components/TaskDrawer.tsx` (the one fallback reader), `app/(app)/_components/selection-bridge.tsx` (bridge + switch).
- `useSelectionBridge` referenced in **11** source files: its definition in `selection-bridge.tsx` + **10** view call sites (`board`, `backlog`, `roadmap`, `epics`, `dashboard`, `versions`, `workflows`, `automations`, `project-settings`, `projects`).

---

## Batch L — Retire the selection bridge

Teardown order removes each reader *before* the data it reads, so the build stays green at every commit: **L1** drops the only non-bridge reader (TaskDrawer), **L2** drops the writer's zustand mirror (the switch), **L3** deletes the bridge hook + its 10 call sites, **L4** deletes the now-dead zustand slice.

### Task L1: Make `TaskDrawer` prop-only (drop the zustand `workspaceId` fallback)

`TaskDrawer` resolves `workspaceId = workspaceIdProp ?? storeWorkspaceId`. Three of its four render sites already pass `workspaceId={ctx.activeWorkspaceId}` (`board-view.tsx:353`, `backlog-view.tsx:388`, `roadmap-view.tsx:153`). Only `epics-view.tsx` does not. Add it there, then delete the store fallback.

**Files:**
- Modify: `apps/next-web/src/app/(app)/epics/epics-view.tsx:312`
- Modify: `apps/next-web/src/components/TaskDrawer.tsx` (import line 11; fallback lines 92–97)

- [ ] **Step 1: Pass `workspaceId` from the one render site that omits it**

In `epics-view.tsx`, line 312 is currently:
```tsx
      <TaskDrawer task={selectedTask as any} onClose={() => setSelectedEpicId(null)} />
```
Change to (`ctx` is already in scope — it's used by `useSelectionBridge` at line 95–102):
```tsx
      <TaskDrawer
        task={selectedTask as any}
        workspaceId={ctx.activeWorkspaceId}
        onClose={() => setSelectedEpicId(null)}
      />
```

- [ ] **Step 2: Delete the store fallback in `TaskDrawer.tsx`**

Remove the import at line 11:
```tsx
import { useStore } from '@/store/useStore';
```
(Confirm it is the only `useStore` usage in the file first: `git grep -n "useStore" -- apps/next-web/src/components/TaskDrawer.tsx` → expect only line 11 + line 96.)

Replace the fallback block (current lines 92–97):
```tsx
  // Prefer the parent's resolved workspace; fall back to the persisted
  // selection store. Either covers the case where currentWorkspaceId hasn't
  // been written yet but the board still rendered via its workspaces[0]
  // fallback. (Selection state is removed from the store in Phase 3 Batch K.)
  const storeWorkspaceId = useStore((s) => s.currentWorkspaceId);
  const workspaceId = workspaceIdProp ?? storeWorkspaceId;
```
with:
```tsx
  // Workspace comes from the opener as a prop (every render site passes
  // `ctx.activeWorkspaceId`). The drawer only opens on a task, which always
  // belongs to an active workspace, so a null prop is not expected here.
  const workspaceId = workspaceIdProp ?? null;
```

- [ ] **Step 3: Gate** — tsc + vitest + build (Task P1 Step 2 runner). Fix to green.

- [ ] **Step 4: Commit**

```bash
git add apps/next-web/src/app/(app)/epics/epics-view.tsx apps/next-web/src/components/TaskDrawer.tsx
git commit -m "refactor(next-web): TaskDrawer workspaceId is prop-only (drop zustand selection fallback)"
```

### Task L2: Drop the zustand mirror from `useSelectionSwitch`

The switch writes the cookie (`setSelection` + `router.refresh()`) **and** mirrors into zustand. After L1 nothing reads the zustand selection except the bridge itself, so the mirror is dead weight. Remove it; keep the cookie write.

**Files:** Modify `apps/next-web/src/app/(app)/_components/selection-bridge.tsx` (lines 45–60)

- [ ] **Step 1: Replace `useSelectionSwitch` (lines 45–60)** with the cookie-only version:

```tsx
/** Switch handlers: write the cookie; the server re-render is the single source of truth. */
export function useSelectionSwitch() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const switchWorkspace = useCallback((id: string) => {
    // projectId: null clears any project scoped to the previous workspace
    startTransition(async () => { await setSelection({ workspaceId: id, projectId: null }); router.refresh(); });
  }, [router]);
  const switchProject = useCallback((id: string) => {
    startTransition(async () => { await setSelection({ projectId: id }); router.refresh(); });
  }, [router]);
  return { switchWorkspace, switchProject };
}
```
(Removes the `setCurrentWorkspace`/`setCurrentProject` reads + their calls. `useStore` is still imported by `useSelectionBridge` at this point — do not remove the import yet; L3 does.)

- [ ] **Step 2: Gate** — tsc + vitest + build. Fix to green.

- [ ] **Step 3: Commit**

```bash
git add apps/next-web/src/app/(app)/_components/selection-bridge.tsx
git commit -m "refactor(next-web): useSelectionSwitch writes cookie only (drop zustand mirror)"
```

### Task L3: Delete `useSelectionBridge` + remove its 10 call sites

After L1+L2 nothing depends on the zustand selection being kept in sync, so the bridge hook is dead. Delete the hook (and the `Ctx` interface + the now-unused `useStore`/`useEffect` imports) from `selection-bridge.tsx`, then remove every `useSelectionBridge({...})` call + its import token from the 10 views.

**Files:**
- Modify: `apps/next-web/src/app/(app)/_components/selection-bridge.tsx` (lines 1–42)
- Modify (10 views — remove the `useSelectionBridge` import token + the call block):

  | View | Import line | Call site |
  |------|-------------|-----------|
  | `app/(app)/board/board-view.tsx` | 15 (`useSelectionBridge, WorkspaceProjectSwitcher,`) | 63–71 |
  | `app/(app)/backlog/backlog-view.tsx` | 16 (`useSelectionBridge, WorkspaceProjectSwitcher,`) | 96 |
  | `app/(app)/roadmap/roadmap-view.tsx` | 9 (`useSelectionBridge, WorkspaceProjectSwitcher`) | 29–37 |
  | `app/(app)/epics/epics-view.tsx` | 10 (`useSelectionBridge, WorkspaceProjectSwitcher`) | 94–102 |
  | `app/(app)/dashboard/dashboard-view.tsx` | 24 (`useSelectionBridge, WorkspaceProjectSwitcher`) | 51 |
  | `app/(app)/versions/versions-view.tsx` | 13 (`useSelectionBridge, WorkspaceProjectSwitcher`) | 81 |
  | `app/(app)/workflows/workflows-view.tsx` | 14 (`useSelectionBridge, WorkspaceProjectSwitcher`) | 68 |
  | `app/(app)/automations/automations-view.tsx` | 27 (`useSelectionBridge,`) | 114 |
  | `app/(app)/project-settings/project-settings-view.tsx` | 15 (`useSelectionBridge,`) | 64 |
  | `app/(app)/projects/projects-view.tsx` | 13 (`useSelectionBridge, useSelectionSwitch`) | 66–77 |

- [ ] **Step 1: Trim `selection-bridge.tsx` to switch + switcher only.** Delete the `Ctx` interface and the entire `useSelectionBridge` function (current lines 9–42), and fix the imports. The file's top should become exactly:

```tsx
'use client';

import { useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setSelection } from '@/server/actions/selection';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
```
Then the (L2-simplified) `useSelectionSwitch`, then `WorkspaceProjectSwitcher` (unchanged). Removed vs. the original: the `useStore` import, the `useEffect` import token, the `Ctx` interface, and the whole `useSelectionBridge` function.

- [ ] **Step 2: Remove the import token in each of the 10 views.** In each file, drop `useSelectionBridge` from the `from '@/app/(app)/_components/selection-bridge'` import, keeping the other named imports (`WorkspaceProjectSwitcher` and/or `useSelectionSwitch`). Example — `roadmap-view.tsx:9`:
```tsx
// before
import { useSelectionBridge, WorkspaceProjectSwitcher } from '@/app/(app)/_components/selection-bridge';
// after
import { WorkspaceProjectSwitcher } from '@/app/(app)/_components/selection-bridge';
```
`projects-view.tsx:13` keeps `useSelectionSwitch`:
```tsx
import { useSelectionSwitch } from '@/app/(app)/_components/selection-bridge';
```

- [ ] **Step 3: Delete the `useSelectionBridge({...})` call block in each of the 10 views.** Each block has the identical shape (a leading comment + the call, ending at the matching `});`). Example — `roadmap-view.tsx` lines 29–37:
```tsx
  // ── Selection bridge — keeps zustand in sync with server cookie truth ───────
  useSelectionBridge({
    activeWorkspaceId: ctx.activeWorkspaceId,
    activeProjectId: ctx.activeProjectId,
    cookieWorkspaceId: ctx.cookieWorkspaceId,
    cookieProjectId: ctx.cookieProjectId,
    workspaceIds: ctx.workspaces.map((w) => w.id),
    projectIds: ctx.projects.map((p) => p.id),
  });
```
Delete the whole block (and its preceding comment line). Do the same in all 10 files — the only variation is `projects-view.tsx`, which passes `activeProjectId: null` / `projectIds: []` (workspace-only page); delete it the same way. The switcher still renders from `ctx`/server props, unchanged.

- [ ] **Step 4: Confirm zero residue**

```bash
git grep -n "useSelectionBridge" -- apps/next-web/src   # expect: empty
```

- [ ] **Step 5: Gate** — tsc + vitest + build. (tsc will flag any view that referenced a now-removed local from the deleted block — none should, but fix any straggler.)

- [ ] **Step 6: Commit**

```bash
git add apps/next-web/src
git commit -m "refactor(next-web): remove useSelectionBridge — switcher/drawer drive off cookie + server props"
```

### Task L4: Remove the dead selection slice from the zustand store

Nothing reads `currentWorkspaceId`/`currentProjectId` now. Remove the `SelectionState` slice; keep `BoardState` (columns) + `RoadmapState` (viewport).

**Files:** Modify `apps/next-web/src/store/useStore.ts`

- [ ] **Step 1: Confirm the slice is dead**

```bash
git grep -n "currentWorkspaceId\|currentProjectId\|setCurrentWorkspace\|setCurrentProject" -- apps/next-web/src
```
Expect: only `store/useStore.ts` (definitions). No readers. (If `TaskDrawer.tsx` still appears, L1 was not completed — stop and finish it.)

- [ ] **Step 2: Delete the `SelectionState` interface (lines 28–37):**
```ts
// Shared workspace/project selection across pages. ...
interface SelectionState {
  currentWorkspaceId: string | null;
  currentProjectId:   string | null;
  setCurrentWorkspace: (id: string | null) => void;
  setCurrentProject:   (id: string | null) => void;
}
```

- [ ] **Step 3: Drop `SelectionState` from the store type union (line 60):**
```ts
export const useStore = create<BoardState & RoadmapState>()(
```

- [ ] **Step 4: Remove the selection fields/setters from the initializer (lines 65–69):**
```ts
      // Selection state — persisted so it survives reloads.
      currentWorkspaceId: null,
      currentProjectId:   null,
      setCurrentWorkspace: (id) => set({ currentWorkspaceId: id, currentProjectId: null }),
      setCurrentProject:   (id) => set({ currentProjectId: id }),
```

- [ ] **Step 5: Remove the selection keys from `partialize` (lines 80–85),** leaving only the roadmap viewport:
```ts
      partialize: (s) => ({
        roadmapZoom:       s.roadmapZoom,
        roadmapScrollLeft: s.roadmapScrollLeft,
      }),
```
Update the file's top comment (lines 56–59) to drop "the workspace/project selection," — the store now holds only board columns + roadmap viewport. Leave `name: 'pf-selection'` as-is (renaming would reset persisted roadmap viewport for existing users; the legacy key harmlessly ignores the dropped fields on read).

- [ ] **Step 6: Gate** — tsc + vitest + build.

- [ ] **Step 7: Two-stage review + interactive smoke (the non-negotiable gate).** Login, then exercise the bridge's old job end-to-end:
  - Switch **workspace** on `/board` → board re-renders that workspace's projects/tasks (server data), project dropdown resets.
  - Switch **project** on `/board`, `/backlog`, `/roadmap`, `/epics` → each re-renders the new project's data.
  - **Reload** each page → the switch persists (cookie), no flash of the wrong workspace.
  - Open a card on `/board`, `/backlog`, `/epics`, `/roadmap` → the **member/assignee picker loads** (this is the TaskDrawer `workspaceId` path L1 changed).
  - `/projects` workspace switch still works (it uses `useSelectionSwitch` directly).
  - Use the `e2e/_smoke` scripts (`login.mjs`, `board-mutate.mjs`, route sweep) as the harness.

- [ ] **Step 8: Commit**

```bash
git add apps/next-web/src/store/useStore.ts
git commit -m "refactor(next-web): remove dead zustand selection slice (cookie is sole selection truth)"
```

> **Batch L gate:** `git grep -n "useSelectionBridge\|currentWorkspaceId\|setCurrentWorkspace" -- apps/next-web/src` returns nothing; switcher + drawer fully exercised live; `useStore` holds only board columns + roadmap viewport.

---

## Batch M — Fix the date-locale hydration mismatch (`/projects` + `/roadmap`)

`Intl.DateTimeFormat(undefined, …)` / `toLocaleDateString(undefined, …)` picks en-US on the Node server and id-ID in the browser → React logs a hydration mismatch on the SSR'd first render. Introduce a shared fixed-locale helper (test-first), then apply it to the two named sites.

> **Locale choice:** `'en-US'` — matches the app's current server-rendered output, so the *displayed* format is unchanged; only the client stops disagreeing with the server. (If the product wants Indonesian dates, swap the one `LOCALE` constant to `'id-ID'` — it is the single knob.)

### Task M1: Add a fixed-locale date helper (test-first)

**Files:**
- Create: `apps/next-web/src/lib/date.ts`
- Test: `apps/next-web/src/lib/__tests__/date.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/next-web/src/lib/__tests__/date.test.ts
import { describe, it, expect } from 'vitest';
import { formatShortDate, formatShortDateYear } from '@/lib/date';

describe('date formatters (fixed en-US locale, hydration-safe)', () => {
  // Constructed from local components so the assertion is timezone-independent.
  const d = new Date(2026, 2, 15); // local March 15, 2026

  it('formatShortDate → "Mar 15"', () => {
    expect(formatShortDate(d)).toBe('Mar 15');
  });

  it('formatShortDateYear → "Mar 15, 2026"', () => {
    expect(formatShortDateYear(d)).toBe('Mar 15, 2026');
  });

  it('accepts an ISO string', () => {
    expect(formatShortDateYear('2026-03-15T12:00:00')).toBe('Mar 15, 2026');
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter next-web exec vitest run src/lib/__tests__/date.test.ts`
Expected: FAIL — `@/lib/date` has no export `formatShortDate`.

- [ ] **Step 3: Implement the helper**

```ts
// apps/next-web/src/lib/date.ts
// Fixed locale so the Node server (defaults to en-US) and the browser (e.g.
// id-ID) format dates identically — Intl.DateTimeFormat(undefined) diverges
// between them and triggers a React hydration mismatch on any SSR'd date
// (pre-existing on /projects + /roadmap). 'en-US' matches the app's existing
// server-rendered output, so the visible format is unchanged.
const LOCALE = 'en-US';

export const shortDate = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric' });
export const shortDateYear = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });

export function formatShortDate(d: Date | string): string {
  return shortDate.format(typeof d === 'string' ? new Date(d) : d);
}

export function formatShortDateYear(d: Date | string): string {
  return shortDateYear.format(typeof d === 'string' ? new Date(d) : d);
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter next-web exec vitest run src/lib/__tests__/date.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/next-web/src/lib/date.ts apps/next-web/src/lib/__tests__/date.test.ts
git commit -m "feat(next-web): add fixed-locale date helper (hydration-safe formatting)"
```

### Task M2: Apply the helper on `/projects`

**Files:** Modify `apps/next-web/src/app/(app)/projects/projects-view.tsx` (line 333)

- [ ] **Step 1: Add the import** (top of file, with the other `@/lib` imports):
```tsx
import { formatShortDateYear } from '@/lib/date';
```

- [ ] **Step 2: Replace line 333:**
```tsx
// before
          Created {new Date(createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
// after
          Created {formatShortDateYear(createdAt)}
```

- [ ] **Step 3: Gate** (tsc/vitest/build). **Step 4: Commit** `fix(next-web): fixed-locale created date on /projects (drop hydration mismatch)`.

### Task M3: Apply the helper on `/roadmap` (the Gantt axis formatter)

The mismatch source is the module-scope `SHORT_DATE` formatter in the Gantt chart.

**Files:** Modify `apps/next-web/src/components/GanttChart.tsx` (line 67)

- [ ] **Step 1: Add the import** (top of file):
```tsx
import { shortDate as SHORT_DATE } from '@/lib/date';
```

- [ ] **Step 2: Delete the local formatter at line 67:**
```ts
const SHORT_DATE = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
```
All existing `SHORT_DATE.format(...)` call sites keep working unchanged (same name, same options, now fixed-locale). Confirm no other `Intl.DateTimeFormat(undefined`/`toLocale*(undefined` remains in this file: `git grep -n "undefined" -- apps/next-web/src/components/GanttChart.tsx` (review the format calls).

- [ ] **Step 3: Gate** (tsc/vitest/build).

- [ ] **Step 4: Interactive smoke** — load `/projects` and `/roadmap` in a running app with the browser locale set to **id-ID** (the reported repro); open DevTools console and confirm **no "hydration mismatch" / "Text content did not match" warning**. Capture before/after console screenshots into `e2e/_smoke/p31/`.

- [ ] **Step 5: Commit** `fix(next-web): fixed-locale Gantt axis on /roadmap (drop hydration mismatch)`.

### Task M4 (OPTIONAL — consistency sweep, not the reported bug)

The same `toLocale*(undefined)` pattern exists elsewhere (`components/TaskCard.tsx:127-130`, `GitIntegrationSettings.tsx:185`, `SlackTeamsSettings.tsx:203`, `WebhookManager.tsx:49`, `app/(app)/automations/automations-view.tsx:87`, `app/(app)/notifications/notifications-view.tsx:61`). These were **not** in the reported bug (only `/projects` + `/roadmap` were). Only do this if the team wants to prevent recurrence:

- [ ] Convert each SSR-rendered site to the `@/lib/date` helper (add `formatShortTime`/`formatDateTime` variants to `date.ts` as needed, test-first per M1). Gate + commit `chore(next-web): adopt fixed-locale date helper app-wide`.

> **Batch M gate:** `/projects` + `/roadmap` produce no hydration warning with an id-ID browser; `date.test.ts` green; visible date format unchanged (en-US).

---

## Batch N — Verify the account-gated surfaces (no code)

These were written, reviewed, and statically green in Phase 3 but never exercised at runtime because the smoke user lacks the prerequisites. **No code changes** unless verification surfaces a defect — if it does, stop and open a focused fix task (do not patch ad hoc inside this batch).

**Surfaces under test:**
- OAuth: `app/login/page.tsx` (provider buttons), `app/oauth/finish/page.tsx`, `app/oauth/mfa/page.tsx`, `app/oauth/error/page.tsx`; server `server/actions/oauth.ts`, `server/queries/oauth.ts`, `server/auth-decision.ts`.
- Admin roles: `components/admin/RolesTab.tsx`, `components/admin/RoleEditorDialog.tsx`, inline `UserRolesDialog` in `app/(app)/admin/admin-view.tsx`; server `server/queries/admin-roles.ts`, `server/actions/admin-roles.ts`.

### Task N1: Verify OAuth login end-to-end

**Prerequisite (blocking):** real OAuth provider credentials (client id/secret + configured redirect URI) for at least one provider, set in the API/web env. **If unavailable, mark this task BLOCKED and record why — do not fake it.**

- [ ] **Step 1:** Start the app (API + next-web). On `/login`, click the provider button → confirm redirect to the provider consent screen.
- [ ] **Step 2:** Approve consent → confirm the callback lands on `/oauth/finish`, exchanges the code, sets the `pf_at`/`pf_rt` cookies, and redirects into the app authenticated (no AuthBootstrap flash — Phase 3 removed it).
- [ ] **Step 3:** If the account has MFA, confirm `/oauth/mfa` renders and completes. Force an error (e.g. deny consent) → confirm `/oauth/error` renders the message, not a crash.
- [ ] **Step 4:** Reload an app page → session persists (cookie). Logout → cookies cleared → `/login`.
- [ ] **Step 5:** Record the outcome (PASS / BLOCKED + reason) in `memory/csr-ssr-migration-state.md`; capture screenshots into `e2e/_smoke/p31/oauth/`. Optionally add a `e2e/_smoke/oauth.mjs` harness if a test provider is available.

### Task N2: Verify admin-roles CRUD

**Prerequisite (blocking):** an **admin** account (the standing smoke user is intentionally non-admin). **If unavailable, mark BLOCKED — do not grant the smoke user admin just to pass this; that would invalidate the non-admin sidebar-gating smoke from Phase 3.**

- [ ] **Step 1:** Log in as the admin account → confirm the **Admin** link is visible (server-derived `isAdmin`, Phase 3 Task J1) and `/admin` loads.
- [ ] **Step 2:** Roles tab: **create** a role (name/description/scope) → **edit** its name/description → **set permissions** (PermissionPicker) → confirm persisted on reload → **delete** it.
- [ ] **Step 3:** User-roles (UserRolesDialog): **assign** a role to a user in a workspace → confirm it shows → **revoke** it.
- [ ] **Step 4:** Confirm a **non-admin** account still cannot see the Admin link or reach `/admin` (regression guard on the same change).
- [ ] **Step 5:** Record PASS / BLOCKED in `memory/csr-ssr-migration-state.md`; capture into `e2e/_smoke/p31/admin/` (alongside the existing `e2e/_smoke/p3/admin-roles.png` from the account-gated Phase 3 attempt).

### Task N3: Close Phase 3.1

**Files:** `memory/csr-ssr-migration-state.md` + `MEMORY.md` index line.

- [ ] **Step 1:** Update `memory/csr-ssr-migration-state.md`: selection bridge fully retired (cookie is sole truth); date-locale warning fixed on `/projects` + `/roadmap`; OAuth/admin-roles verification result (PASS, or BLOCKED + the missing prerequisite). Update the `MEMORY.md` pointer line.
- [ ] **Step 2:** `git commit --allow-empty -m "chore(ssr): Phase 3.1 cleanup verified — selection bridge retired, date-locale fixed; OAuth/admin-roles <PASS|BLOCKED>"`.
- [ ] **Step 3:** Invoke superpowers:finishing-a-development-branch (merge/PR decision), matching how Phase 3 was integrated (local ff-merge to `main`).

> **Batch N gate:** OAuth + admin-roles either verified PASS live, or explicitly recorded BLOCKED with the exact missing prerequisite — no silent "assumed working."

---

## Self-review notes (coverage against the request)

- "Selection state isn't fully consolidated to the cookie … retire the bridge (drive switcher + drawer off server props/cookie alone)" → **Batch L** (L1 drawer prop-only, L2 switch cookie-only, L3 delete bridge + 10 call sites, L4 delete store slice). ✓
- "It's used by ~10 views, so it's not dead" → L3 table enumerates all **10** call sites + the hook definition; teardown order keeps the build green at each commit. ✓
- "date-locale hydration mismatch on /projects + /roadmap (toLocaleDateString(undefined) → en-US server vs id-ID browser); fix with a fixed locale" → **Batch M** (M1 helper test-first, M2 `/projects:333`, M3 `/roadmap` Gantt `SHORT_DATE`). The two named sites are the exact reported repro. ✓
- "OAuth login (needs real provider creds) and admin-roles CRUD (needs an admin account) … written, reviewed, statically green — just not exercised at runtime" → **Batch N** (N1 OAuth, N2 admin-roles), both gated on the named prerequisite with explicit BLOCKED handling. ✓
- "polish, not the migration … no Phase 4" → stated in Goal + scope; nothing here changes migration architecture. ✓

**Placeholder scan:** every code step shows the exact before/after; every gate names its command + expected result; the only intentional "fill-in" is the recorded PASS/BLOCKED verdict in N (which is the deliverable, not a placeholder).

**Open items the implementer confirms at execution time (flagged, not placeholders):** the exact line ranges of each `useSelectionBridge({...})` block in the 8 views not shown verbatim (the table gives the call-site line; the block is the identical ~8-line shape ending at the matching `});`); whether OAuth provider creds / an admin account are actually available (Batch N prerequisites).
