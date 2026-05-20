# CSR → SSR Migration — Phase 2 (Full Sweep) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each **Batch** ends green (typecheck + build + tests) before the next.

**Goal:** Convert every remaining `(app)` page from the client-side-rendered, react-query + in-memory-token pattern to the Phase 1 server-first pattern (async Server Component shell fetching via the DAL + a `'use client'` view fed by props + domain Server Actions), ending with the high-risk Board (drag-drop via `useOptimistic` + a reorder action), so the first paint of every page is server-rendered HTML.

**Architecture:** For each route, the page's **own initial-paint reads** move into an `async` Server Component (`page.tsx`) that calls `cache()`-wrapped DAL queries (`src/server/queries/*`), and the page's **own mutations** move into domain Server Actions (`src/server/actions/*`) that `serverFetch` then `revalidatePath`. The existing client UI moves verbatim into a `'use client'` `*-view.tsx` fed by props. Workspace/project selection is read server-side from the `pf_sel` cookie (now carrying `projectId` too) and kept in sync with legacy zustand via a shared **selection bridge** until Phase 3. **Interaction-triggered, self-fetching child components** (TaskDrawer + Comment/Attachment/WorkLog/PullRequests sections, charts, GanttChart, the integration components, and the admin Roles editors) keep their react-query + in-memory token and are **deferred to Phase 3** — they keep working because `AuthBootstrap` keeps the in-memory token alive throughout Phase 2.

**Tech Stack:** Next.js 16 (App Router, RSC, async `cookies()`/`params`, Server Actions, `revalidatePath`, `useOptimistic`, `useTransition`), React 19, `@dnd-kit` (Board), Hono backend (`apps/api`), Vitest.

**Spec:** `docs/superpowers/specs/2026-05-20-csr-to-ssr-migration-design.md` (§3.3 DAL, §3.4 actions, §3.5 page pattern, §6 inventory, §7 Phase 2)
**Recipe (from Phase 1):** `docs/superpowers/recipes/rsc-page-migration.md`
**Phase 1 reference implementation:** `apps/next-web/src/app/(app)/projects/` + `apps/next-web/src/server/`
**Branch:** `feat/csr-to-ssr-phase2-sweep` (already checked out, off `main` @ Phase 1 merge)

---

## ⚠️ Next.js 16 caveats (read first)

`apps/next-web/AGENTS.md`: *"This is NOT the Next.js you know… Read the relevant guide in `node_modules/next/dist/docs/` before writing any code."* Confirmed facts this plan relies on (verified against the installed version during planning):

1. **`unstable_rethrow` from `next/navigation`** — already used in `src/server/actions/projects.ts` (Phase 1), so it is confirmed available. Use it in every action `catch` so a `redirect()` thrown by `serverFetch` on 401 propagates instead of being swallowed.
2. **`revalidatePath` from `next/cache`** — confirmed (used in `selection.ts`, `projects.ts`).
3. **`cookies()` is async**; cookies can only be **set** in Server Actions / Route Handlers, never during render. All selection writes go through `setSelection` (exists).
4. **`params` is async** in Next 16 dynamic routes: `export default async function Page({ params }: { params: Promise<{ id: string }> })` then `const { id } = await params`. The current dynamic pages read `useParams()` client-side — they must switch to the awaited `params` prop in the server shell and pass `id` into the view.
5. **`useSearchParams()` forces dynamic rendering** and must be wrapped in `<Suspense>`. Backlog and Board persist filters in the URL; their views keep `useSearchParams` and the route relies on its `loading.tsx`/Suspense boundary.

---

## Phase 2 strategy & key decisions (apply throughout)

These decisions are derived from reading the current code (`api.ts`, `auth-bootstrap.tsx`, `useStore.ts`, `CommentSection.tsx`) during planning. They are the difference between a tractable sweep and a rewrite.

1. **The in-memory token is alive during all of Phase 2.** `src/app/(app)/auth-bootstrap.tsx` still wraps the `(app)` layout and calls `POST /api/auth/refresh` on mount → `setAuth(token, user)`. Removing `AuthBootstrap`, `providers.tsx` (QueryClient), and the in-memory token is **Phase 3**, not here. Therefore any client component left unconverted keeps working.

2. **Migrate page-owned data only; defer self-fetching children to Phase 3.** A page's *initial-paint* `useQuery` calls (workspaces, projects, the page's list/report data) move to the server shell. A page's *own* `useMutation` calls move to Server Actions. **Child components that own their own data and are revealed by interaction** stay `'use client'` + react-query for now:
   - `TaskDrawer` and its sections `CommentSection`, `AttachmentSection`, `WorkLogSection`, `PullRequestsSection` (opened on card click — not first-paint data).
   - `charts/*` (already presentational — they receive data via props; only the page's report *reads* move).
   - `GanttChart` (presentational; receives `items`/`deps` props and fires callbacks).
   - `WebhookManager`, `GitIntegrationSettings`, `SlackTeamsSettings` (tab-revealed, self-fetching).
   - admin `RolesTab`, `RoleEditorDialog`, `PermissionPicker` (tab-revealed, self-fetching).
   A `'use client'` component renders fine inside an `async` Server Component (RSC composition). This keeps each page task small and the diff reviewable.

3. **Selection cookie now carries `projectId`.** Phase 1 only switched workspace. Most Phase 2 pages are project-scoped. The `Selection` type and `setSelection` already support `projectId` (`src/server/selection.ts`, `src/server/actions/selection.ts`). A shared server helper resolves `{ activeWorkspaceId, activeProjectId }` from the cookie (validated against fetched lists), and a shared client **selection bridge** mirrors both into zustand and seeds the cookie from legacy localStorage on first migrated visit. Both are built once in the Foundation batch and reused by every page.

4. **`serverFetch` returns only `json.data`.** Endpoints that put data in `meta` need the full envelope: `/tasks` → `meta.assigneesByTaskId`, `/notifications` → `meta.unreadCount`. Foundation adds `serverFetchEnvelope<T>()` returning `{ data, meta }`.

5. **`serverFetch` hardcodes `Content-Type: application/json`** — this breaks multipart uploads (avatar, attachments). Foundation adjusts it to **omit the default JSON content-type when the body is `FormData`** (so `fetch` sets the multipart boundary). This is additive and safe for every existing caller.

6. **No new react-query in migrated views.** Migrated `*-view.tsx` files use props + Server Actions + `useTransition`/`useOptimistic` only. (The deferred child components still use react-query — that's expected and removed in Phase 3.)

7. **Error UX parity.** Mutations return `ActionResult` (`{ ok: true } | { ok: false; error }`, defined in `actions/projects.ts`); views surface failures the same way the page does today — inline dialog error or `notifyApiError` toast (`src/lib/apiErrorToast`).

---

## Scope

**In scope (Phase 2):** server-shell + view-split + DAL + Server Actions for these routes —
`user-guide`, `setup`, `notifications`, `graphql-explorer`, `roadmap`, `dashboard`, `epics`, `versions`, `workflows`, `automations`, `project-settings`, `workspaces`, `workspaces/[id]/settings`, `workspaces/[id]/members`, `projects/[id]/settings`, `settings/profile`, `settings/connected-accounts`, `admin`, `backlog`, and **`board`** (last).

**Out of scope (Phase 3 teardown):** removing `AuthBootstrap`, `providers.tsx`/QueryClient, the in-memory `accessToken`/`setAuth`/`clearAuth` and the zustand selection slice + bridge; converting the deferred self-fetching children (TaskDrawer + sections, integration components, admin Roles editors) off react-query/token; converting the `(app)` layout / sidebar to RSC; removing the client `/api/v1` rewrite.

---

## File structure (created across the sweep)

**Foundation (Batch F):**
- `apps/next-web/src/server/actions/result.ts` — shared `ActionResult` type.
- `apps/next-web/src/server/queries/select-context.ts` — pure `resolveActiveId()` (tested).
- `apps/next-web/src/server/queries/__tests__/select-context.test.ts`
- `apps/next-web/src/server/context.ts` — `getWorkspaceProjectContext()` (`server-only`).
- `apps/next-web/src/server/api.ts` — **modify**: add `serverFetchEnvelope`; FormData-aware content-type.
- `apps/next-web/src/app/(app)/_components/selection-bridge.tsx` — `'use client'` `useSelectionBridge()` + `useSelectionSwitch()` + `WorkspaceProjectSwitcher` (generalized from `projects-view.tsx`).

**DAL queries (one file per domain, `src/server/queries/`):** `sprints.ts`, `tasks.ts`, `reports.ts`, `epics.ts`, `roadmap.ts`, `notifications.ts`, `versions.ts`, `workflows.ts`, `automations.ts`, `labels.ts`, `components.ts`, `workspace.ts` (single + members), `project.ts` (single), `profile.ts`, `oauth.ts`, `admin.ts`. Plus a pure `normalize-task.ts` (tested).

**Server Actions (one file per domain, `src/server/actions/`):** `tasks.ts`, `epics.ts`, `roadmap.ts`, `notifications.ts`, `versions.ts`, `workflows.ts`, `automations.ts`, `labels.ts`, `components.ts`, `workspaces.ts`, `members.ts`, `profile.ts`, `oauth.ts`, `admin.ts`, `graphql.ts`, `setup.ts`; **modify** `projects.ts` (add `updateProject`).

**Pages:** each route gets `page.tsx` (replaced with server shell), `<route>-view.tsx` (new client view), `loading.tsx` (new skeleton).

---

## The per-page recipe (apply to EVERY page task below)

Every page task follows these steps. The task-specific section gives only the **deltas** (exact endpoints, query/action code, shell code, and which helpers move). Do not deviate from this skeleton; it is the locked Phase 1 pattern.

1. **DAL queries** — create/extend `src/server/queries/<domain>.ts`: `import 'server-only'; import { cache } from 'react';` each fn `serverFetch`es one endpoint and maps rows through a pure normalizer. Use `serverFetchEnvelope` when `meta` is needed.
2. **Server Actions** — create/extend `src/server/actions/<domain>.ts`: `'use server';` each action `await requireSession()`, `try { await serverFetch(...) } catch (e) { return toActionError(e); }`, then `revalidatePath('/<route>')`, `return { ok:true }`. Reuse `ActionResult` from `actions/result.ts` and `toActionError` from `actions/error.ts` (added during execution). `toActionError` rethrows Next redirect/notFound control-flow and otherwise maps the thrown `ApiError` (from `serverFetch`) to `{ ok:false, error, code, status }` so curated error toasts (e.g. `WORKSPACE_FROZEN`) still fire.
3. **`page.tsx`** → `async` Server Component: `await requireSession()`; if workspace/project-scoped, `const ctx = await getWorkspaceProjectContext()` (redirect `/setup` when empty); fetch page data via DAL (`Promise.all` for independent reads); render `<XView ...props />`. Dynamic routes: read `const { id } = await params`.
4. **`<route>-view.tsx`** → `'use client'`: paste the existing page body; delete the inline `api()` helper, `useQuery`/`useMutation`, `useQueryClient`, and the `accessToken` reads; data comes from props; mutations call the new actions inside `useTransition`; surface action failures with `notifyActionError(res)` (from `@/lib/apiErrorToast`) — it forwards the action's `code`+`status` to the curated toast — or inline `res.error` for dialog forms; for workspace/project-scoped pages call `useSelectionBridge(...)` and render `<WorkspaceProjectSwitcher .../>` instead of the inline dropdowns.
5. **`loading.tsx`** → move the page's old in-component skeleton here (or a simple `Skeleton` block).
6. **Verify**: `npx tsc --noEmit`; `grep` the route's `page.tsx` for `@tanstack/react-query|fetch('/api/v1|use client` → no output; build the route. Then **commit**.

> Working directory for all `npx`/`npm` commands is `apps/next-web` (`cd apps/next-web` first). Commit after each task.

---

## Batch F — Foundation (shared building blocks)

### Task F0: Shared `ActionResult` type

**Files:**
- Create: `apps/next-web/src/server/actions/result.ts`
- Modify: `apps/next-web/src/server/actions/projects.ts` (import + re-export instead of redefining)

- [ ] **Step 1: Create the shared type**

```ts
// apps/next-web/src/server/actions/result.ts
export type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };
```

- [ ] **Step 2: Point projects.ts at it** — replace the local `export type ActionResult = …` with:
```ts
import type { ActionResult } from './result';
export type { ActionResult };
```

- [ ] **Step 3: Typecheck + commit**
```bash
cd apps/next-web && npx tsc --noEmit
git add apps/next-web/src/server/actions/result.ts "apps/next-web/src/server/actions/projects.ts"
git commit -m "refactor(next-web): extract shared ActionResult type"
```

---

### Task F1: Pure selection resolver (TDD)

**Files:**
- Create: `apps/next-web/src/server/queries/select-context.ts`
- Test: `apps/next-web/src/server/queries/__tests__/select-context.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
// apps/next-web/src/server/queries/__tests__/select-context.test.ts
import { describe, it, expect } from 'vitest';
import { resolveActiveId } from '../select-context';

describe('resolveActiveId', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('uses the cookie id when it is in the list', () => { expect(resolveActiveId(list, 'b')).toBe('b'); });
  it('falls back to the first item when the cookie id is missing', () => { expect(resolveActiveId(list, 'zzz')).toBe('a'); });
  it('falls back to the first item when the cookie id is null', () => { expect(resolveActiveId(list, null)).toBe('a'); });
  it('returns null for an empty list', () => { expect(resolveActiveId([], 'a')).toBeNull(); });
});
```

- [ ] **Step 2: Run → FAIL** — `cd apps/next-web && npx vitest run src/server/queries/__tests__/select-context.test.ts` (Cannot find module).

- [ ] **Step 3: Implement**
```ts
// apps/next-web/src/server/queries/select-context.ts
// Pure: pick the active id from a list given the cookie's stored id. Trust the
// cookie only if it still points at something the user has; else default to first.
export function resolveActiveId<T extends { id: string }>(list: T[], cookieId: string | null): string | null {
  if (list.length === 0) return null;
  if (cookieId && list.some((x) => x.id === cookieId)) return cookieId;
  return list[0]!.id;
}
```

- [ ] **Step 4: Run → PASS** (4 tests).

- [ ] **Step 5: Commit**
```bash
git add apps/next-web/src/server/queries/select-context.ts apps/next-web/src/server/queries/__tests__/select-context.test.ts
git commit -m "feat(next-web): add pure active-id selection resolver (TDD)"
```

---

### Task F2: `serverFetch` envelope + FormData support

**Files:** Modify: `apps/next-web/src/server/api.ts`

- [ ] **Step 1: Replace the file**
```ts
// apps/next-web/src/server/api.ts
import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE } from './cookies';

const API_BASE =
  process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface Envelope<T> { data?: T; meta?: Record<string, unknown>; error?: { message?: string }; }

async function call<T>(path: string, init: RequestInit): Promise<{ envelope: Envelope<T>; status: number }> {
  if (!path.startsWith('/')) throw new Error(`serverFetch: path must start with "/" (got "${path}")`);
  const token = (await cookies()).get(COOKIE.access)?.value;
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    ...init,
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }), // let fetch set multipart boundary
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (res.status === 401) redirect('/login');
  if (res.status === 204) return { envelope: {}, status: 204 };
  const envelope = (await res.json().catch(() => ({}))) as Envelope<T>;
  if (!res.ok) throw new Error(envelope?.error?.message ?? `Request failed (${res.status})`);
  return { envelope, status: res.status };
}

/** Returns the unwrapped `data` field. `path` is the part AFTER `/api/v1`. */
export async function serverFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const { envelope } = await call<T>(path, init);
  return envelope.data as T;
}

/** Returns the full `{ data, meta }` for endpoints that carry data in `meta`. */
export async function serverFetchEnvelope<T = unknown, M = Record<string, unknown>>(
  path: string, init: RequestInit = {},
): Promise<{ data: T; meta: M }> {
  const { envelope } = await call<T>(path, init);
  return { data: envelope.data as T, meta: (envelope.meta ?? {}) as M };
}
```

- [ ] **Step 2: Typecheck + tests + commit**
```bash
cd apps/next-web && npx tsc --noEmit && npx vitest run
git add apps/next-web/src/server/api.ts
git commit -m "feat(next-web): add serverFetchEnvelope + FormData-aware serverFetch"
```

---

### Task F3: Workspace/project context helper

**Files:** Create: `apps/next-web/src/server/context.ts`

- [ ] **Step 1: Implement**
```ts
// apps/next-web/src/server/context.ts
import 'server-only';
import { cache } from 'react';
import { getWorkspaces } from './queries/workspaces';
import { getProjects } from './queries/projects';
import { getSelection } from './selection';
import { resolveActiveId } from './queries/select-context';
import type { Workspace, Project } from './queries/normalize';

export interface WorkspaceProjectContext {
  workspaces: Workspace[];
  projects: Project[];
  activeWorkspaceId: string;        // '' only when workspaces is empty (caller -> /setup)
  activeProjectId: string | null;   // null when the workspace has no projects
  cookieWorkspaceId: string | null;
  cookieProjectId: string | null;
}

export const getWorkspaceProjectContext = cache(async (): Promise<WorkspaceProjectContext> => {
  const workspaces = await getWorkspaces();
  const { workspaceId: cookieWorkspaceId, projectId: cookieProjectId } = await getSelection();
  const activeWorkspaceId = resolveActiveId(workspaces, cookieWorkspaceId);
  if (activeWorkspaceId === null) {
    return { workspaces: [], projects: [], activeWorkspaceId: '', activeProjectId: null, cookieWorkspaceId, cookieProjectId };
  }
  const projects = await getProjects(activeWorkspaceId);
  const activeProjectId = resolveActiveId(projects, cookieProjectId);
  return { workspaces, projects, activeWorkspaceId, activeProjectId, cookieWorkspaceId, cookieProjectId };
});
```

- [ ] **Step 2: Typecheck + commit**
```bash
cd apps/next-web && npx tsc --noEmit
git add apps/next-web/src/server/context.ts
git commit -m "feat(next-web): add getWorkspaceProjectContext DAL helper"
```

---

### Task F4: Shared selection bridge + switcher

**Files:** Create: `apps/next-web/src/app/(app)/_components/selection-bridge.tsx`

- [ ] **Step 1: Implement**
```tsx
// apps/next-web/src/app/(app)/_components/selection-bridge.tsx
'use client';

import { useCallback, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/store/useStore';
import { setSelection } from '@/server/actions/selection';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Ctx {
  activeWorkspaceId: string; activeProjectId: string | null;
  cookieWorkspaceId: string | null; cookieProjectId: string | null;
  workspaceIds: string[]; projectIds: string[];
}

/** Keep legacy zustand selection in sync with the cookie/server truth until Phase 3. */
export function useSelectionBridge(ctx: Ctx) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const setCurrentWorkspace = useStore((s) => s.setCurrentWorkspace);
  const setCurrentProject = useStore((s) => s.setCurrentProject);
  const legacyWorkspaceId = useStore((s) => s.currentWorkspaceId);
  const legacyProjectId = useStore((s) => s.currentProjectId);

  useEffect(() => {
    if (
      ctx.cookieWorkspaceId === null &&
      legacyWorkspaceId &&
      legacyWorkspaceId !== ctx.activeWorkspaceId &&
      ctx.workspaceIds.includes(legacyWorkspaceId)
    ) {
      const seedProject = legacyProjectId && ctx.projectIds.includes(legacyProjectId) ? legacyProjectId : undefined;
      startTransition(async () => {
        await setSelection({ workspaceId: legacyWorkspaceId, ...(seedProject ? { projectId: seedProject } : {}) });
        router.refresh();
      });
      return;
    }
    if (legacyWorkspaceId !== ctx.activeWorkspaceId) setCurrentWorkspace(ctx.activeWorkspaceId);
    if (ctx.activeProjectId && legacyProjectId !== ctx.activeProjectId) setCurrentProject(ctx.activeProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.activeWorkspaceId, ctx.activeProjectId, ctx.cookieWorkspaceId]);
}

/** Switch handlers: write the cookie + mirror zustand + router.refresh().
 * router.refresh() is REQUIRED — revalidatePath alone does not refresh the
 * server-rendered data on switch (proven by Phase 1 fix e004a59). */
export function useSelectionSwitch() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const setCurrentWorkspace = useStore((s) => s.setCurrentWorkspace);
  const setCurrentProject = useStore((s) => s.setCurrentProject);
  const switchWorkspace = useCallback((id: string) => {
    setCurrentWorkspace(id);
    // projectId: null clears any project scoped to the previous workspace
    startTransition(async () => { await setSelection({ workspaceId: id, projectId: null }); router.refresh(); });
  }, [router, setCurrentWorkspace]);
  const switchProject = useCallback((id: string) => {
    setCurrentProject(id);
    startTransition(async () => { await setSelection({ projectId: id }); router.refresh(); });
  }, [router, setCurrentProject]);
  return { switchWorkspace, switchProject };
}

interface SwitcherProps {
  workspaces: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  activeWorkspaceId: string; activeProjectId: string | null; showProject?: boolean;
}

export function WorkspaceProjectSwitcher({
  workspaces, projects, activeWorkspaceId, activeProjectId, showProject = true,
}: SwitcherProps) {
  const { switchWorkspace, switchProject } = useSelectionSwitch();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {workspaces.length > 1 && (
        <Select value={activeWorkspaceId} onValueChange={switchWorkspace}>
          <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="Workspace" /></SelectTrigger>
          <SelectContent>{workspaces.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
        </Select>
      )}
      {showProject && projects.length > 0 && activeProjectId && (
        <Select value={activeProjectId} onValueChange={switchProject}>
          <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="Project" /></SelectTrigger>
          <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Refactor `projects-view.tsx` to use the shared hook (DRY)** — replace its inline bridge `useEffect` + `switchWorkspace` with `useSelectionBridge({...})` + `useSelectionSwitch()` (or `<WorkspaceProjectSwitcher showProject={false}/>`). Keep prop names.

- [ ] **Step 3: Typecheck + commit**
```bash
cd apps/next-web && npx tsc --noEmit
git add "apps/next-web/src/app/(app)/_components/selection-bridge.tsx" "apps/next-web/src/app/(app)/projects/projects-view.tsx"
git commit -m "feat(next-web): add shared selection bridge + workspace/project switcher"
```

- [ ] **Step 4: Batch F gate** — `cd apps/next-web && npx tsc --noEmit && npx vitest run && npm run build` all green. Manually confirm `/projects` still works (switch workspace, create/archive/delete) after the F4 refactor.

---

## Batch A — Read-mostly pages

> Order: simplest first. Each task = the per-page recipe; only deltas shown.

### Task A1: `user-guide` (verify only)

`src/app/(app)/user-guide/page.tsx` is **already** an async Server Component reading `docs/USER_GUIDE.md` and passing markdown to a `'use client'` `GuideViewer`. No react-query, no client fetch.

- [ ] **Step 1:** Confirm: `cd apps/next-web && grep -n "use client\|react-query\|/api/v1" "src/app/(app)/user-guide/page.tsx"` → no output.
- [ ] **Step 2:** `git commit -m "chore(ssr): user-guide already RSC-compliant (Phase 2 no-op)" --allow-empty`

---

### Task A2: `setup`

**Files:** Create `src/server/actions/setup.ts`, `src/app/(app)/setup/setup-view.tsx`; replace `src/app/(app)/setup/page.tsx`.
**READS:** none. **MUTATIONS:** `POST /workspaces {name,slug}` → then `POST /projects {workspaceId,name,key,type:'SCRUM'}`.

- [ ] **Step 1: Action**
```ts
// apps/next-web/src/server/actions/setup.ts
'use server';
import { unstable_rethrow } from 'next/navigation';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { setSelection } from './selection';
import type { ActionResult } from './result';

function slugify(s: string) { return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function keyify(s: string) { return (s.trim().split(/\s+/).map((p) => p[0]).join('') || s.slice(0, 4)).slice(0, 4).toUpperCase(); }

export async function bootstrapWorkspace(input: { workspaceName: string; projectName: string }): Promise<ActionResult> {
  await requireSession();
  try {
    const ws = await serverFetch<{ Id?: string; id?: string }>('/workspaces', {
      method: 'POST', body: JSON.stringify({ name: input.workspaceName, slug: slugify(input.workspaceName) }),
    });
    const workspaceId = String(ws?.Id ?? ws?.id ?? '');
    await serverFetch('/projects', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, name: input.projectName, key: keyify(input.projectName), type: 'SCRUM' }),
    });
    await setSelection({ workspaceId, projectId: null });
  } catch (e) { unstable_rethrow(e); return { ok: false, error: e instanceof Error ? e.message : 'Setup failed' }; }
  return { ok: true };
}
```
- [ ] **Step 2: View** — `setup-view.tsx` (`'use client'`): move the form; replace the two inline `fetch`es with one `bootstrapWorkspace(...)` in `useTransition`; on `res.ok` `router.push('/board')`, else show `res.error`. Use `@/components/ui/*` inputs (drop the hardcoded host + inline styles).
- [ ] **Step 3: Page shell**
```tsx
// apps/next-web/src/app/(app)/setup/page.tsx
import { requireSession } from '@/server/session';
import { SetupView } from './setup-view';
export default async function SetupPage() { await requireSession(); return <SetupView />; }
```
- [ ] **Step 4:** Verify + commit `feat(next-web): convert setup to server shell + bootstrap action`.

---

### Task A3: `notifications`

User-scoped. **READS:** `GET /notifications?page=&pageSize=20&unreadOnly=` → `{ data, meta:{unreadCount} }`. **MUTATIONS:** `PATCH /notifications/{id}/read`, `PATCH /notifications/mark-all-read`.
**Files:** Create `queries/notifications.ts`, `actions/notifications.ts`, `notifications-view.tsx`, `loading.tsx`; replace `page.tsx`.

- [ ] **Step 1: Query**
```ts
// apps/next-web/src/server/queries/notifications.ts
import 'server-only';
import { cache } from 'react';
import { serverFetchEnvelope } from '../api';
export interface NotificationRow { id: string; title: string; body: string | null; isRead: boolean; createdAt: string; taskId?: string | null; [k: string]: unknown; }
export const getNotifications = cache(async (
  opts: { page?: number; pageSize?: number; unreadOnly?: boolean } = {},
): Promise<{ items: NotificationRow[]; unreadCount: number; page: number }> => {
  const page = opts.page ?? 1, pageSize = opts.pageSize ?? 20;
  const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (opts.unreadOnly) qs.set('unreadOnly', 'true');
  const { data, meta } = await serverFetchEnvelope<NotificationRow[], { unreadCount?: number }>(`/notifications?${qs}`);
  return { items: data ?? [], unreadCount: meta?.unreadCount ?? 0, page };
});
```
- [ ] **Step 2: Actions** — `markNotificationRead(id)` (`PATCH /notifications/{id}/read`), `markAllNotificationsRead()` (`PATCH /notifications/mark-all-read`); both `revalidatePath('/notifications')`.
- [ ] **Step 3: Page shell** — pagination/tab via `searchParams`:
```tsx
// apps/next-web/src/app/(app)/notifications/page.tsx
import { requireSession } from '@/server/session';
import { getNotifications } from '@/server/queries/notifications';
import { NotificationsView } from './notifications-view';
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ page?: string; tab?: string }> }) {
  await requireSession();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const unreadOnly = sp.tab === 'unread';
  const { items, unreadCount } = await getNotifications({ page, unreadOnly });
  return <NotificationsView items={items} unreadCount={unreadCount} page={page} unreadOnly={unreadOnly} />;
}
```
- [ ] **Step 4: View** — move list/tabs/pagination; tab+page → `<Link href="?tab=unread&page=N">`; mark-read / mark-all via actions in `useTransition` (errors → `notifyApiError`). `loading.tsx` = list skeleton.
- [ ] **Step 5:** Verify + commit `feat(next-web): convert notifications to RSC + server actions`.

---

### Task A4: `graphql-explorer`

**READS:** none. **MUTATIONS:** `POST /graphql {query,variables}` (+ optional pasted token override).
**Files:** Create `actions/graphql.ts`, `graphql-explorer-view.tsx`; replace `page.tsx`.

- [ ] **Step 1: Action** (carry the cookie token for the normal path; honor an override)
```ts
// apps/next-web/src/server/actions/graphql.ts
'use server';
import { cookies } from 'next/headers';
import { requireSession } from '../session';
import { COOKIE } from '../cookies';

const API_BASE = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export async function runGraphql(
  query: string, variables: Record<string, unknown>, tokenOverride?: string,
): Promise<{ status: number; ms: number; body: unknown }> {
  await requireSession();
  const token = tokenOverride ?? (await cookies()).get(COOKIE.access)?.value;
  const t0 = Date.now();
  const res = await fetch(`${API_BASE}/api/v1/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }), cache: 'no-store',
  });
  return { status: res.status, ms: Date.now() - t0, body: await res.json().catch(() => ({})) };
}
```
- [ ] **Step 2: View** — move the editors/examples/result UI; Run button → `runGraphql(query, vars, overrideToken)` in `useTransition`; render `status`, `ms`, `JSON.stringify(body)`.
- [ ] **Step 3: Page shell** — `requireSession()` then render the view (no `loading.tsx`).
- [ ] **Step 4:** Verify + commit `feat(next-web): convert graphql-explorer to server action`.

---

### Task A5: `roadmap`

Project-scoped. **READS:** ctx + `GET /roadmap?projectId=` → `{items,deps}`. **MUTATIONS:** `PATCH /roadmap/tasks/{taskId}/dates`.
**Files:** Create `queries/roadmap.ts`, `actions/roadmap.ts`, `roadmap-view.tsx`, `loading.tsx`; replace `page.tsx`.

- [ ] **Step 1: Query**
```ts
// apps/next-web/src/server/queries/roadmap.ts
import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';
export interface RoadmapData { items: any[]; deps: any[]; }
export const getRoadmap = cache(async (projectId: string): Promise<RoadmapData> => {
  const data = await serverFetch<RoadmapData>(`/roadmap?projectId=${encodeURIComponent(projectId)}`);
  return { items: data?.items ?? [], deps: data?.deps ?? [] };
});
```
- [ ] **Step 2: Action**
```ts
// apps/next-web/src/server/actions/roadmap.ts
'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import type { ActionResult } from './result';
export async function updateTaskDates(
  taskId: string,
  input: { startDate?: string | null; dueDate?: string | null; clearStartDate?: boolean; clearDueDate?: boolean },
): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch(`/roadmap/tasks/${encodeURIComponent(taskId)}/dates`, { method: 'PATCH', body: JSON.stringify(input) }); }
  catch (e) { unstable_rethrow(e); return { ok: false, error: e instanceof Error ? e.message : 'Update failed' }; }
  revalidatePath('/roadmap'); return { ok: true };
}
```
- [ ] **Step 3: Page shell**
```tsx
// apps/next-web/src/app/(app)/roadmap/page.tsx
import { redirect } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getWorkspaceProjectContext } from '@/server/context';
import { getRoadmap } from '@/server/queries/roadmap';
import { RoadmapView } from './roadmap-view';
export default async function RoadmapPage() {
  await requireSession();
  const ctx = await getWorkspaceProjectContext();
  if (ctx.workspaces.length === 0) redirect('/setup');
  const roadmap = ctx.activeProjectId ? await getRoadmap(ctx.activeProjectId) : { items: [], deps: [] };
  return <RoadmapView ctx={ctx} items={roadmap.items} deps={roadmap.deps} />;
}
```
- [ ] **Step 4: View** — move markup; `useSelectionBridge(...)`; `<WorkspaceProjectSwitcher>`; pass `items`/`deps` to `<GanttChart>`; wire `onUpdateDates` → `updateTaskDates(...)` in `useTransition` then `router.refresh()`; keep `TaskDrawer` (client). Roadmap zoom/scroll stays in zustand. `loading.tsx` = header + chart skeleton.
- [ ] **Step 5:** Verify + commit `feat(next-web): convert roadmap to RSC + dates action`.

---

### Task A6: `dashboard`

Project/sprint-scoped, **read-only**. **READS:** ctx + sprints + tasks(count) + 5 reports. **MUTATIONS:** none. Sprint selection → `?sprint=`.
**Files:** Create `queries/sprints.ts`, `queries/reports.ts`, `queries/tasks.ts` (full version in D1 — implement D1 first or inline a minimal `getTasks` here and replace in D1), `dashboard-view.tsx`, `loading.tsx`; replace `page.tsx`.

- [ ] **Step 1: sprints query**
```ts
// apps/next-web/src/server/queries/sprints.ts
import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';
export interface Sprint { id: string; name: string; status?: string; [k: string]: unknown; }
export const getSprints = cache(async (projectId: string): Promise<Sprint[]> => {
  const data = await serverFetch<any[]>(`/sprints?projectId=${encodeURIComponent(projectId)}`);
  return (data ?? []).map((r) => ({ ...r, id: String(r?.Id ?? r?.id ?? ''), name: String(r?.Name ?? r?.name ?? '') }));
});
```
- [ ] **Step 2: reports query**
```ts
// apps/next-web/src/server/queries/reports.ts
import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';
const q = (p: string) => serverFetch<any>(p);
export const getBurndown = cache((sprintId: string) => q(`/reports/burndown?sprintId=${encodeURIComponent(sprintId)}`));
export const getVelocity = cache((projectId: string, n = 6) => q(`/reports/velocity?projectId=${encodeURIComponent(projectId)}&numSprints=${n}`));
export const getSprintSummary = cache((sprintId: string) => q(`/reports/sprint-summary?sprintId=${encodeURIComponent(sprintId)}`));
export const getWorkload = cache((projectId: string) => q(`/reports/workload?projectId=${encodeURIComponent(projectId)}`));
export const getCreatedVsResolved = cache((projectId: string, weeks = 8) => q(`/reports/created-vs-resolved?projectId=${encodeURIComponent(projectId)}&weeks=${weeks}`));
```
- [ ] **Step 3: Page shell** — ctx → sprints → active sprint from `?sprint=` (default first) → `Promise.all` reports + `getTasks(activeProjectId,{pageSize:500})`; guard each report when project/sprint is null. Pass props.
- [ ] **Step 4: View** — move markup; charts via props (unchanged); `<WorkspaceProjectSwitcher>`; sprint dropdown writes `?sprint=`. `loading.tsx` = KPI + chart-grid skeleton.
- [ ] **Step 5:** Verify + commit `feat(next-web): convert dashboard to RSC report fetching`.

---

### Task A7: `epics`

Project-scoped. **READS:** ctx + `GET /epics?projectId=`. **MUTATIONS:** `POST /tasks {title,type:'EPIC',priority,projectId,workspaceId,dueDate?}`.
**Files:** Create `queries/epics.ts`, `actions/epics.ts`, `epics-view.tsx`, `loading.tsx`; replace `page.tsx`.

- [ ] **Step 1: Query**
```ts
// apps/next-web/src/server/queries/epics.ts
import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';
export interface Epic {
  id: string; issueKey: string; title: string; status: string; priority: string;
  startDate: string | null; dueDate: string | null; totalChildren: number; completedChildren: number;
}
export const getEpics = cache(async (projectId: string): Promise<Epic[]> => {
  const data = await serverFetch<any[]>(`/epics?projectId=${encodeURIComponent(projectId)}`);
  return (data ?? []).map((r) => ({
    id: String(r?.Id ?? r?.id ?? ''), issueKey: String(r?.IssueKey ?? r?.issueKey ?? ''),
    title: String(r?.Title ?? r?.title ?? '(untitled)'), status: String(r?.Status ?? r?.status ?? 'To Do'),
    priority: String(r?.Priority ?? r?.priority ?? 'Medium'),
    startDate: (r?.StartDate ?? r?.startDate) || null, dueDate: (r?.DueDate ?? r?.dueDate) || null,
    totalChildren: Number(r?.TotalChildren ?? r?.totalChildren ?? 0),
    completedChildren: Number(r?.CompletedChildren ?? r?.completedChildren ?? 0),
  }));
});
```
- [ ] **Step 2: Action**
```ts
// apps/next-web/src/server/actions/epics.ts
'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import type { ActionResult } from './result';
export async function createEpic(input: {
  workspaceId: string; projectId: string; title: string; priority: string; dueDate?: string | null;
}): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch('/tasks', { method: 'POST', body: JSON.stringify({
      title: input.title, type: 'EPIC', priority: input.priority,
      projectId: input.projectId, workspaceId: input.workspaceId, dueDate: input.dueDate || null,
    }) });
  } catch (e) { unstable_rethrow(e); return { ok: false, error: e instanceof Error ? e.message : 'Create failed' }; }
  revalidatePath('/epics'); return { ok: true };
}
```
- [ ] **Step 3: Page shell** — ctx + `getEpics(activeProjectId)` (empty when no project).
- [ ] **Step 4: View** — move markup + filters; `<WorkspaceProjectSwitcher>`; "New epic" dialog → `createEpic(...)` in `useTransition`; card click opens `TaskDrawer` (unchanged). `loading.tsx` = epic-grid skeleton.
- [ ] **Step 5:** Verify + commit `feat(next-web): convert epics to RSC + createEpic action`.

- [ ] **Batch A gate:** `cd apps/next-web && npx tsc --noEmit && npx vitest run && npm run build` green. Manual smoke: each route first-paints data (view-source) and mutations reflect without manual reload.

---

## Batch B — CRUD pages

### Task B1: `versions`

Project-scoped. **READS:** ctx + `GET /versions?projectId=`. **MUTATIONS:** create/patch/release/archive/delete.
**Files:** Create `queries/versions.ts`, `actions/versions.ts`, `versions-view.tsx`, `loading.tsx`; replace `page.tsx`.

- [ ] **Step 1: Query**
```ts
// apps/next-web/src/server/queries/versions.ts
import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';
export interface Version {
  id: string; name: string; status: string; description: string | null;
  startDate: string | null; releaseDate: string | null; createdAt: string | null;
  completedIssues: number; totalIssues: number;
}
export const getVersions = cache(async (projectId: string): Promise<Version[]> => {
  const data = await serverFetch<any[]>(`/versions?projectId=${encodeURIComponent(projectId)}`);
  return (data ?? []).map((r) => ({
    id: String(r?.Id ?? r?.id ?? ''), name: String(r?.Name ?? r?.name ?? ''),
    status: String(r?.Status ?? r?.status ?? 'UNRELEASED'), description: (r?.Description ?? r?.description) || null,
    startDate: (r?.StartDate ?? r?.startDate) || null, releaseDate: (r?.ReleaseDate ?? r?.releaseDate) || null,
    createdAt: (r?.CreatedAt ?? r?.createdAt) || null,
    completedIssues: Number(r?.CompletedIssues ?? r?.completedIssues ?? 0),
    totalIssues: Number(r?.TotalIssues ?? r?.totalIssues ?? 0),
  }));
});
```
- [ ] **Step 2: Actions** — `createVersion(input)` (`POST /versions`), `updateVersion(id, changed)` (`PATCH /versions/{id}`), `releaseVersion(id)` (`POST /versions/{id}/release`), `archiveVersion(id)` (`POST /versions/{id}/archive`), `deleteVersion(id, projectId)` (`DELETE /versions/{id}?projectId=`). Each `requireSession` → `serverFetch` → `revalidatePath('/versions')` → `ActionResult`.
- [ ] **Step 3: Page shell** — ctx + `getVersions(activeProjectId)`.
- [ ] **Step 4: View** — move markup + search/status filter/sort + create/edit dialogs; mutations via actions in `useTransition`. `loading.tsx` = KPI + list skeleton.
- [ ] **Step 5:** Verify + commit `feat(next-web): convert versions to RSC + version actions`.

---

### Task B2: `workflows`

Project-scoped. **READS:** ctx + `GET /workflows?projectId=` → workflow|null. **MUTATIONS:** 6 (see below).
**Files:** Create `queries/workflows.ts`, `actions/workflows.ts`, `workflows-view.tsx`, `loading.tsx`; replace `page.tsx`.

- [ ] **Step 1: Query**
```ts
// apps/next-web/src/server/queries/workflows.ts
import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';
export interface Workflow { id: string; name: string; statuses: any[]; transitions: any[]; }
export const getWorkflow = cache(async (projectId: string): Promise<Workflow | null> => {
  const data = await serverFetch<any>(`/workflows?projectId=${encodeURIComponent(projectId)}`);
  if (!data) return null;
  return { id: String(data.Id ?? data.id ?? ''), name: String(data.Name ?? data.name ?? ''),
    statuses: data.statuses ?? data.Statuses ?? [], transitions: data.transitions ?? data.Transitions ?? [] };
});
```
- [ ] **Step 2: Actions** — `createWorkflow(projectId,name,template)` (`POST /workflows`); `addStatus(wfId,{name,category,color})` (`POST /workflows/{wfId}/statuses`); `updateStatus(statusId,changed)` (`PATCH /workflows/statuses/{statusId}`); `deleteStatus(statusId)` (`DELETE /workflows/statuses/{statusId}`); `addTransition(wfId,{fromStatus,toStatus})` (`POST /workflows/{wfId}/transitions`); `deleteTransition(wfId,{fromStatus,toStatus})` (`DELETE /workflows/{wfId}/transitions` with body). All `revalidatePath('/workflows')`.
- [ ] **Step 3: Page shell** — ctx + `getWorkflow(activeProjectId)`.
- [ ] **Step 4: View** — move markup incl. create-workflow panel (when `workflow===null`), status grouping, inline rename/color/category, transitions add/remove; replace `window.alert` errors with `notifyApiError`. `loading.tsx` = editor skeleton.
- [ ] **Step 5:** Verify + commit `feat(next-web): convert workflows to RSC + workflow actions`.

---

### Task B3: `automations`

Project-scoped. **READS:** ctx + `GET /automations?projectId=`. **MUTATIONS:** create/patch/toggle/delete.
**Files:** Create `queries/automations.ts`, `actions/automations.ts`, `automations-view.tsx`, `loading.tsx`; replace `page.tsx`.

- [ ] **Step 1: Query** — `getAutomations(projectId)` (`GET /automations?projectId=`; normalize id/name; keep rule payload fields as-is).
- [ ] **Step 2: Actions** — `createAutomation(input)` (`POST /automations`), `updateAutomation(id, body)` (`PATCH /automations/{id}`), `toggleAutomation(id, isEnabled)` (`POST /automations/{id}/toggle`), `deleteAutomation(id)` (`DELETE /automations/{id}`); `revalidatePath('/automations')`.
- [ ] **Step 3: Page shell** — ctx + `getAutomations(activeProjectId)`.
- [ ] **Step 4: View** — move markup incl. trigger/condition/action editors (client form state) + toggle switches; submit via actions in `useTransition`. `loading.tsx` = list skeleton.
- [ ] **Step 5:** Verify + commit `feat(next-web): convert automations to RSC + automation actions`.

---

### Task B4: `project-settings`

Tabbed. Migrate **page-owned** Labels + Components; **defer** Git/Messaging/Webhooks (self-fetching components stay client).
**Files:** Create `queries/labels.ts`, `queries/components.ts`, `actions/labels.ts`, `actions/components.ts`, `project-settings-view.tsx`, `loading.tsx`; replace `page.tsx`.

- [ ] **Step 1: Queries** — `getLabels(projectId)` (`GET /labels?projectId=`), `getComponents(projectId)` (`GET /components?projectId=`).
- [ ] **Step 2: Actions** — labels `createLabel/updateLabel/deleteLabel` (`POST/PATCH/DELETE /labels`); components `createComponent/updateComponent/deleteComponent` (`POST/PATCH/DELETE /components`); `revalidatePath('/project-settings')`.
- [ ] **Step 3: Page shell** — ctx + labels + components; pass `activeWorkspaceId` (for the deferred integration components' `workspaceId` prop) + `activeProjectId`.
- [ ] **Step 4: View** — move the tabbed UI; Labels/Components use props + actions; the Git/Messaging/Webhooks tabs render `<GitIntegrationSettings workspaceId={...}/>` etc. **unchanged**. `loading.tsx` = tab skeleton.
- [ ] **Step 5:** Verify (route `page.tsx` has no react-query; deferred components still do — expected) + commit `feat(next-web): convert project-settings labels/components to RSC (integrations deferred)`.

---

### Task B5: `workspaces`

User-scoped list + create. **READS:** `GET /workspaces` (exists). **MUTATIONS:** `POST /workspaces {name,slug}`.
**Files:** Create `actions/workspaces.ts`, `workspaces-view.tsx`, `loading.tsx`; replace `page.tsx`.

- [ ] **Step 1: Action** — `createWorkspace(name, slug)` → `revalidatePath('/workspaces')` + `revalidatePath('/', 'layout')`. `slugify` lives in the view.
- [ ] **Step 2: Page shell** — `getWorkspaces()` + current user id (from `getSession()`) for the ownership badge.
- [ ] **Step 3: View** — move markup + create dialog + slug auto-gen; create via action. `loading.tsx` = grid skeleton.
- [ ] **Step 4:** Verify + commit `feat(next-web): convert workspaces list to RSC + create action`.

---

### Task B6: `backlog`

Project-scoped. Reuses `getTasks` (D1) + `getSprints` (A6) + task actions (D2). URL filters under Suspense; `TaskDrawer` stays client.
**Files:** Create `backlog-view.tsx`, `loading.tsx`; replace `page.tsx`.
**READS:** ctx + `GET /tasks?projectId=&pageSize=200` (+ assignees meta) + `GET /sprints?projectId=`. **MUTATIONS:** `POST /tasks`, `DELETE /tasks/{id}`, `PATCH /tasks/{id} {priority}`.

> **Sequence:** implement **D1 (task DAL) + D2 (task actions) before this task.** If executing strictly top-to-bottom, do D1+D2 now, then return here.

- [ ] **Step 1: Page shell** — ctx + `Promise.all([getTasks(activeProjectId,{pageSize:200}), getSprints(activeProjectId)])`; wrap `<BacklogView>` in `<Suspense fallback={<Loading/>}>` (URL filters).
- [ ] **Step 2: View** — move markup (collapsible sections, inline create, priority dropdown, delete confirm); filters/search stay in the URL; replace optimistic react-query with `useOptimistic` (delete + priority) or `useTransition` + revalidate; `createTask`/`deleteTask`/`updateTaskPriority` actions; `TaskDrawer` unchanged. `loading.tsx` = list skeleton.
- [ ] **Step 3:** Verify + commit `feat(next-web): convert backlog to RSC + task actions`.

- [ ] **Batch B gate:** typecheck + tests + build green; manual smoke of B routes.

---

## Batch C — Dynamic-param & account/settings pages

### Task C1: `workspaces/[id]/settings`

Dynamic param. **READS:** `GET /workspaces/{id}`. **MUTATIONS:** `PATCH /workspaces/{id}`, `DELETE /workspaces/{id}`.
**Files:** Create `queries/workspace.ts` (single + members; members used by C2), extend `actions/workspaces.ts`, `workspace-settings-view.tsx`, `loading.tsx`; replace `page.tsx`.

- [ ] **Step 1: Query**
```ts
// apps/next-web/src/server/queries/workspace.ts
import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';
export interface WorkspaceDetail { id: string; name: string; slug: string; avatarUrl: string | null; status: string; }
export const getWorkspace = cache(async (id: string): Promise<WorkspaceDetail> => {
  const r = await serverFetch<any>(`/workspaces/${encodeURIComponent(id)}`);
  return { id: String(r?.Id ?? r?.id ?? id), name: String(r?.Name ?? r?.name ?? ''),
    slug: String(r?.Slug ?? r?.slug ?? ''), avatarUrl: (r?.AvatarUrl ?? r?.avatarUrl) || null,
    status: String(r?.Status ?? r?.status ?? 'ACTIVE') };
});
export interface MemberRow { id: string; email: string; name: string | null; avatarUrl: string | null; roleSlugs: string; isOwner: boolean; }
export const getWorkspaceMembers = cache(async (id: string): Promise<MemberRow[]> => {
  const data = await serverFetch<any[]>(`/workspaces/${encodeURIComponent(id)}/members`);
  return (data ?? []).map((r) => ({
    id: String(r?.Id ?? r?.id ?? ''), email: String(r?.Email ?? r?.email ?? ''),
    name: (r?.Name ?? r?.name) || null, avatarUrl: (r?.AvatarUrl ?? r?.avatarUrl) || null,
    roleSlugs: String(r?.RoleSlugs ?? r?.roleSlugs ?? ''), isOwner: Boolean(r?.IsOwner ?? r?.isOwner),
  }));
});
```
- [ ] **Step 2: Actions** — add `updateWorkspace(id, changed)` (`PATCH /workspaces/{id}`), `deleteWorkspace(id)` (`DELETE /workspaces/{id}` → `redirect('/workspaces')` on success); `revalidatePath('/workspaces/'+id+'/settings')` + `revalidatePath('/workspaces')`.
- [ ] **Step 3: Page shell**
```tsx
// apps/next-web/src/app/(app)/workspaces/[id]/settings/page.tsx
import { requireSession } from '@/server/session';
import { getWorkspace } from '@/server/queries/workspace';
import { WorkspaceSettingsView } from './workspace-settings-view';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const workspace = await getWorkspace(id);
  return <WorkspaceSettingsView workspace={workspace} />;
}
```
- [ ] **Step 4: View** — move the form (name/slug/avatarUrl) + delete-confirm; mutations via actions. `loading.tsx` = form skeleton.
- [ ] **Step 5:** Verify + commit `feat(next-web): convert workspace settings to RSC (async params)`.

---

### Task C2: `workspaces/[id]/members`

Dynamic param. **READS:** `GET /workspaces/{id}` + `GET /workspaces/{id}/members`. **MUTATIONS:** invite/remove/role.
**Files:** Create `actions/members.ts`, `members-view.tsx`, `loading.tsx`; replace `page.tsx`. (Queries from C1.)

- [ ] **Step 1: Actions** — `inviteMember(wsId, email, role)` (`POST /workspaces/{id}/members/by-email`), `removeMember(wsId, userId)` (`DELETE /workspaces/{id}/members/{userId}`), `updateMemberRole(wsId, userId, role)` (`PUT /workspaces/{id}/members/{userId}/role`); `revalidatePath('/workspaces/'+wsId+'/members')`.
- [ ] **Step 2: Page shell** — `const { id } = await params`; `Promise.all([getWorkspace(id), getWorkspaceMembers(id)])`.
- [ ] **Step 3: View** — move table + invite dialog + per-row role select + remove confirm; `effectiveRoleInput` (roleSlugs → single role) stays a client helper; mutations via actions. `loading.tsx` = table skeleton.
- [ ] **Step 4:** Verify + commit `feat(next-web): convert workspace members to RSC + member actions`.

---

### Task C3: `projects/[id]/settings`

Dynamic param. **READS:** `GET /projects/{id}`. **MUTATIONS:** `PATCH /projects/{id}`, `POST /projects/{id}/archive` (exists), `DELETE /projects/{id}` (exists).
**Files:** Create `queries/project.ts`, extend `actions/projects.ts` (`updateProject`), `project-settings-detail-view.tsx`, `loading.tsx`; replace `page.tsx`.

- [ ] **Step 1: Query** — `getProject(id)` (`GET /projects/{id}`; normalize fields + ISO dates).
- [ ] **Step 2: Action** — add `updateProject(id, changed)` to `actions/projects.ts`; `revalidatePath('/projects/'+id+'/settings')` + `revalidatePath('/projects')`.
- [ ] **Step 3: Page shell** — `const { id } = await params`; `getProject(id)`.
- [ ] **Step 4: View** — move the form (name/key-readonly/type-toggle/dates/description) + archive/restore/delete lifecycle; `isoToDateInput` stays a client helper; mutations via actions. `loading.tsx` = form skeleton.
- [ ] **Step 5:** Verify + commit `feat(next-web): convert project settings detail to RSC (async params)`.

---

### Task C4: `settings/profile`

User-scoped. **READS:** `GET /auth/me`. **MUTATIONS:** `PATCH /auth/me {name}`, `POST /avatars/me` (multipart), `DELETE /avatars/me`.
**Files:** Create `queries/profile.ts`, `actions/profile.ts`, `profile-view.tsx`, `loading.tsx`; replace `page.tsx`.

- [ ] **Step 1: Query** — `getMe()` (`serverFetch('/auth/me')` → normalized user).
- [ ] **Step 2: Actions**
```ts
// apps/next-web/src/server/actions/profile.ts
'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import type { ActionResult } from './result';
export async function updateMyName(name: string): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch('/auth/me', { method: 'PATCH', body: JSON.stringify({ name }) }); }
  catch (e) { unstable_rethrow(e); return { ok: false, error: e instanceof Error ? e.message : 'Failed' }; }
  revalidatePath('/settings/profile'); return { ok: true };
}
export async function uploadMyAvatar(formData: FormData): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch('/avatars/me', { method: 'POST', body: formData }); } // FormData → no JSON header (F2)
  catch (e) { unstable_rethrow(e); return { ok: false, error: e instanceof Error ? e.message : 'Upload failed' }; }
  revalidatePath('/settings/profile'); return { ok: true };
}
export async function removeMyAvatar(): Promise<ActionResult> {
  await requireSession();
  try { await serverFetch('/avatars/me', { method: 'DELETE' }); }
  catch (e) { unstable_rethrow(e); return { ok: false, error: e instanceof Error ? e.message : 'Failed' }; }
  revalidatePath('/settings/profile'); return { ok: true };
}
```
> **Topbar note:** the avatar previously also called `setAuth(...)` to refresh the in-memory user that the topbar reads. During Phase 2 the topbar avatar still comes from in-memory user; after `uploadMyAvatar` call `router.refresh()` so the profile page updates. The topbar may lag until the next `AuthBootstrap` refresh — acceptable; fully reconciled in Phase 3 when user state moves server-side.

- [ ] **Step 3: Page shell** — `getMe()`.
- [ ] **Step 4: View** — move name form, avatar upload/replace/remove (build `FormData`, call `uploadMyAvatar`), password card, MFA/connected-accounts links; mutations in `useTransition`; reset the file input after upload. `loading.tsx` = profile skeleton.
- [ ] **Step 5:** Verify (actually upload an image) + commit `feat(next-web): convert profile settings to RSC + avatar upload action`.

---

### Task C5: `settings/connected-accounts`

User-scoped. **READS:** `GET /auth/oauth/providers`, `GET /auth/oauth/identities`. **MUTATIONS:** `DELETE /auth/oauth/identities/{provider}`. Link = browser nav.
**Files:** Create `queries/oauth.ts`, `actions/oauth.ts`, `connected-accounts-view.tsx`, `loading.tsx`; replace `page.tsx`.

- [ ] **Step 1: Queries** — `getOAuthProviders()`, `getOAuthIdentities()`.
- [ ] **Step 2: Action** — `disconnectIdentity(provider)` (`DELETE /auth/oauth/identities/{provider}`) → `revalidatePath('/settings/connected-accounts')`; surface `409 LAST_CREDENTIAL` via `ActionResult.error`.
- [ ] **Step 3: Page shell** — `Promise.all([getOAuthProviders(), getOAuthIdentities()])`.
- [ ] **Step 4: View** — move the two sections; disconnect via action in `useTransition` (last-credential warning when `identities.length === 1`); link `<a href="/api/v1/auth/oauth/{provider}/link?returnTo=…">` unchanged. `loading.tsx` = list skeleton.
- [ ] **Step 5:** Verify + commit `feat(next-web): convert connected-accounts to RSC + disconnect action`.

---

### Task C6: `admin`

System-scoped, 5 tabs. Migrate **page-owned** Stats/Users/Workspaces/Audit; **defer** Roles tab (self-fetching).
**Files:** Create `queries/admin.ts`, `actions/admin.ts`, `admin-view.tsx`, `loading.tsx`; replace `page.tsx`.

- **READS (page-owned):** `GET /admin/stats`; `GET /admin/users?search=&page=&pageSize=`; `GET /admin/workspaces?page=&pageSize=`; `GET /admin/audit-log?resource=&action=&fromDate=&toDate=&page=&pageSize=`. **MUTATIONS (page-owned):** user lifecycle + bulk-suspend + workspace status. **Deferred:** `RolesTab`/`RoleEditorDialog`/`PermissionPicker` unchanged.

- [ ] **Step 1: Queries** — `getAdminStats()`, `getAdminUsers(opts)`, `getAdminWorkspaces(opts)`, `getAuditLog(opts)`; lists use `serverFetchEnvelope` (return `{ items, total }` from `meta`).
- [ ] **Step 2: Actions** — `createUser`, `updateUser`, `deleteUser`, `suspendUser`, `restoreUser`, `resetPassword` (returns one-shot temp password in `ActionResult.data`), `disableMfa`, `unlockUser`, `bulkSuspend(userIds, suspend)`, `setWorkspaceStatus(id, status)`; each `revalidatePath('/admin')`.
- [ ] **Step 3: Page shell** — active tab + filters + pagination from `searchParams` (`?tab=&q=&page=&resource=&action=&from=&to=`); fetch only the active tab's data (switch on `tab`). Pass results + current filter values as props.
- [ ] **Step 4: View** — move the 5-tab UI; Stats/Users/Workspaces/Audit driven by props; filters/pagination/search write the URL; bulk-select stays client state; user mutations via actions in `useTransition` (temp-password dialog reads `res.data`); **Roles** tab renders `<RolesTab/>` unchanged. `loading.tsx` = stat-cards + table skeleton.
- [ ] **Step 5:** Verify + commit `feat(next-web): convert admin stats/users/workspaces/audit to RSC (roles deferred)`.

- [ ] **Batch C gate:** typecheck + tests + build green; manual smoke incl. avatar upload, a dynamic-param route, and admin pagination.

---

## Batch D — Board (highest risk) + task DAL/actions

> **Implement D1 + D2 first** — `backlog` (B6) and Board both depend on them.

### Task D1: `getTasks` DAL (envelope) + task normalizer (TDD)

**Files:** Create `queries/normalize-task.ts` + test; `queries/tasks.ts`.

- [ ] **Step 1: Write the failing normalizer test**
```ts
// apps/next-web/src/server/queries/__tests__/normalize-task.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeTask } from '../normalize-task';
describe('normalizeTask', () => {
  it('reads PascalCase', () => {
    const t = normalizeTask({ Id: 't1', Title: 'A', Status: 'To Do', Priority: 'High', Type: 'TASK' });
    expect(t).toMatchObject({ id: 't1', title: 'A', status: 'To Do', priority: 'High', type: 'TASK' });
  });
  it('reads camelCase and defaults', () => {
    const t = normalizeTask({ id: 't2' });
    expect(t).toMatchObject({ id: 't2', status: 'To Do', priority: 'Medium', type: 'TASK' });
  });
});
```
- [ ] **Step 2:** Run → FAIL — `cd apps/next-web && npx vitest run src/server/queries/__tests__/normalize-task.test.ts`
- [ ] **Step 3: Implement `normalize-task.ts`**
```ts
// apps/next-web/src/server/queries/normalize-task.ts
export interface AssigneeRow { TaskId: string; Id?: string; UserId?: string; Name?: string | null; Email?: string; AvatarUrl?: string | null; [k: string]: unknown; }
export interface Task {
  id: string; issueKey: string | null; title: string; description: string | null;
  status: string; priority: string; type: string;
  storyPoints: number | null; startDate: string | null; dueDate: string | null; position: number | null;
}
const s = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const n = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
export function normalizeTask(r: any): Task {
  return {
    id: String(r?.Id ?? r?.id ?? ''),
    issueKey: s(r?.IssueKey ?? r?.issueKey),
    title: String(r?.Title ?? r?.title ?? '(untitled)'),
    description: s(r?.Description ?? r?.description),
    status: String(r?.Status ?? r?.status ?? 'To Do'),
    priority: String(r?.Priority ?? r?.priority ?? 'Medium'),
    type: String(r?.Type ?? r?.type ?? 'TASK'),
    storyPoints: n(r?.StoryPoints ?? r?.storyPoints),
    startDate: s(r?.StartDate ?? r?.startDate),
    dueDate: s(r?.DueDate ?? r?.dueDate),
    position: n(r?.Position ?? r?.position),
  };
}
```
Run → PASS.
- [ ] **Step 4: `getTasks` (envelope)**
```ts
// apps/next-web/src/server/queries/tasks.ts
import 'server-only';
import { cache } from 'react';
import { serverFetchEnvelope } from '../api';
import { normalizeTask, type Task, type AssigneeRow } from './normalize-task';
export const getTasks = cache(async (
  projectId: string, opts: { pageSize?: number } = {},
): Promise<{ tasks: Task[]; assigneesByTaskId: Record<string, AssigneeRow[]> }> => {
  const qs = new URLSearchParams({ projectId });
  if (opts.pageSize) qs.set('pageSize', String(opts.pageSize));
  const { data, meta } = await serverFetchEnvelope<any[], { assigneesByTaskId?: Record<string, AssigneeRow[]> }>(`/tasks?${qs}`);
  return { tasks: (data ?? []).map(normalizeTask), assigneesByTaskId: meta?.assigneesByTaskId ?? {} };
});
```
- [ ] **Step 5: Commit** `feat(next-web): add task normalizer (TDD) + getTasks envelope query`.

### Task D2: Task Server Actions

**Files:** `actions/tasks.ts`.

- [ ] **Step 1: Implement**
```ts
// apps/next-web/src/server/actions/tasks.ts
'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import type { ActionResult } from './result';

async function run(fn: () => Promise<unknown>, paths: string[]): Promise<ActionResult> {
  try { await fn(); } catch (e) { unstable_rethrow(e); return { ok: false, error: e instanceof Error ? e.message : 'Failed' }; }
  for (const p of paths) revalidatePath(p);
  return { ok: true };
}
export const reorderTask = (id: string, position: number, status?: string) =>
  run(() => serverFetch(`/tasks/${encodeURIComponent(id)}/position`, {
    method: 'PATCH', body: JSON.stringify(status ? { position, status } : { position }),
  }), ['/board']);
export const createTask = (input: { title: string; status: string; projectId: string; workspaceId: string }) =>
  run(() => serverFetch('/tasks', { method: 'POST', body: JSON.stringify(input) }), ['/board', '/backlog']);
export const deleteTask = (id: string) =>
  run(() => serverFetch(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }), ['/board', '/backlog']);
export const updateTaskPriority = (id: string, priority: string) =>
  run(() => serverFetch(`/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ priority }) }), ['/backlog', '/board']);
```
> Wrap actions with `requireSession()` — add it inside `run` or at each call. (Add `await requireSession();` as the first line of `run`.)
- [ ] **Step 2: Commit** `feat(next-web): add task reorder/create/delete/priority server actions`.

### Task D3: Board server shell + `useOptimistic` view

**Files:** Replace `src/app/(app)/board/page.tsx`; create `board-view.tsx`, `loading.tsx`.

- [ ] **Step 1: Page shell**
```tsx
// apps/next-web/src/app/(app)/board/page.tsx
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { requireSession } from '@/server/session';
import { getWorkspaceProjectContext } from '@/server/context';
import { getTasks } from '@/server/queries/tasks';
import { getWorkflow } from '@/server/queries/workflows';
import { BoardView } from './board-view';
import BoardLoading from './loading';

export default async function BoardPage() {
  await requireSession();
  const ctx = await getWorkspaceProjectContext();
  if (ctx.workspaces.length === 0) redirect('/setup');
  const [tasksData, workflow] = ctx.activeProjectId
    ? await Promise.all([getTasks(ctx.activeProjectId), getWorkflow(ctx.activeProjectId)])
    : [{ tasks: [], assigneesByTaskId: {} }, null];
  return (
    <Suspense fallback={<BoardLoading />}>
      <BoardView ctx={ctx} tasks={tasksData.tasks} assigneesByTaskId={tasksData.assigneesByTaskId} columns={workflow?.statuses ?? null} />
    </Suspense>
  );
}
```
- [ ] **Step 2: View with optimistic reorder** (fill the render body from the old `page.tsx`)
```tsx
// apps/next-web/src/app/(app)/board/board-view.tsx
'use client';
import { useOptimistic, useTransition } from 'react';
import { reorderTask, createTask, deleteTask } from '@/server/actions/tasks';
import { useSelectionBridge, WorkspaceProjectSwitcher } from '../_components/selection-bridge';
import { notifyApiError } from '@/lib/apiErrorToast';
// ...existing Board imports (Board.tsx, filters, TaskDrawer, etc.)

type OptimisticMove = { taskId: string; position: number; status?: string };

export function BoardView({ ctx, tasks, assigneesByTaskId, columns }: {
  ctx: any; tasks: any[]; assigneesByTaskId: Record<string, any[]>; columns: any[] | null;
}) {
  const [, startTransition] = useTransition();
  useSelectionBridge({
    activeWorkspaceId: ctx.activeWorkspaceId, activeProjectId: ctx.activeProjectId,
    cookieWorkspaceId: ctx.cookieWorkspaceId, cookieProjectId: ctx.cookieProjectId,
    workspaceIds: ctx.workspaces.map((w: any) => w.id), projectIds: ctx.projects.map((p: any) => p.id),
  });
  const [optimisticTasks, applyMove] = useOptimistic(tasks, (state: any[], m: OptimisticMove) =>
    state.map((t) => (t.id === m.taskId ? { ...t, position: m.position, status: m.status ?? t.status } : t)));

  function handleReorder(taskId: string, position: number, status?: string) {
    startTransition(async () => {
      applyMove({ taskId, position, status });
      const res = await reorderTask(taskId, position, status);
      if (!res.ok) notifyApiError({ error: { message: res.error } }, 0);
    });
  }
  function handleAdd(title: string, status: string) {
    startTransition(async () => {
      const res = await createTask({ title, status, projectId: ctx.activeProjectId, workspaceId: ctx.activeWorkspaceId });
      if (!res.ok) notifyApiError({ error: { message: res.error } }, 0);
    });
  }
  function handleDelete(id: string) {
    startTransition(async () => { const res = await deleteTask(id); if (!res.ok) notifyApiError({ error: { message: res.error } }, 0); });
  }
  // Render: <WorkspaceProjectSwitcher .../> + filters(useSearchParams) +
  //   <Board initialTasks={optimisticTasks} assigneesByTaskId={assigneesByTaskId} columns={columns}
  //     onReorderTask={handleReorder} onAddTask={handleAdd} onDeleteTask={handleDelete} onOpenTask={...} />
  //   + <TaskDrawer .../> (unchanged, client)
  return null; // replace with the moved markup
}
```
> **Board.tsx change:** keep its local `tasks` state + `initialTasks` `useEffect` resync + drag animation. Only the data source changes: parent drives truth via `useOptimistic` + `revalidatePath('/board')` (was react-query cache). On drop it still calls `onReorderTask`.

- [ ] **Step 3:** `loading.tsx` = the old `BoardSkeleton` (columns of card skeletons).
- [ ] **Step 4: Verify (critical — drag-drop)**
  - First paint: view-source shows task titles in columns.
  - Drag within a column and across columns → moves instantly and **persists** after the network settles. Kill the API mid-drag once → card reverts + toast (optimistic rollback).
  - Create + delete a card → reflect without manual reload.
  - URL filters still narrow the board and survive back/forward.
  - Open a card → `TaskDrawer` still loads/edits (unchanged).
- [ ] **Step 5: Commit** `feat(next-web): convert Board to RSC + useOptimistic reorder action`.

- [ ] **Batch D gate:** `cd apps/next-web && npx tsc --noEmit && npx vitest run && npm run build` green; drag-drop verification passes.

---

## Final verification (whole sweep)

- [ ] **Build route table:** `cd apps/next-web && npm run build` — every migrated `(app)` route now renders **`ƒ` (Dynamic)** (was `○` Static).
- [ ] **No client `/api/v1` in migrated `page.tsx`:** `cd apps/next-web && grep -rn "@tanstack/react-query\|fetch('/api/v1\|use client" src/app/\(app\)/**/page.tsx` → no output (deferred *components* may still match; pages must not).
- [ ] **Suite green:** `npx vitest run` (incl. `normalize`, `select-context`, `normalize-task`).
- [ ] **Manual E2E** across every route: first paint server-rendered; mutations reflect without manual reload; workspace/project switch re-renders server-side and keeps legacy pages consistent (bridge); auth boundary (`/login` redirect when cookies cleared).
- [ ] **Commit marker:** `git commit -m "chore(ssr): Phase 2 full sweep verified" --allow-empty`.

---

## Self-Review

**Spec coverage (§7 Phase 2 = "convert remaining read-heavy pages … convert Board last"):**
- All read-heavy pages (dashboard, epics, roadmap, backlog, workspaces, versions, workflows, notifications, automations, admin, settings, setup, user-guide, graphql-explorer) → Batches A–C + B6. ✓
- Board last with `useOptimistic` + reorder action → Batch D. ✓
- DAL queries + Server Actions + revalidate per page → recipe + per-task code. ✓
- Selection cookie now carries `projectId`; shared bridge → Foundation F4. ✓
- Dynamic-param routes (workspaces/[id]/{settings,members}, projects/[id]/settings) → C1–C3 with async `params`. ✓
- Settings (profile incl. avatar upload, connected-accounts incl. OAuth) → C4–C5. ✓

**Placeholder scan:** Per-page "view" steps are an explicit verbatim **move** of existing JSX from the route's current `page.tsx` into `*-view.tsx` (recipe + Phase 1 precedent), with the exact fetch→props/action swaps named — not "implement later". DAL/action code is given in full for every non-trivial endpoint; trivial passthrough queries state the exact endpoint + normalize fields. Board view and graphql action show full code for the non-obvious parts.

**Type consistency:** `ActionResult` (F0) reused by every action. `getWorkspaceProjectContext` (F3) returns the exact `ctx` shape every project-scoped page/view consumes. `resolveActiveId` (F1) is used inside F3. `serverFetchEnvelope` (F2) is used by `getNotifications`, `getTasks`, admin lists. `useSelectionBridge`/`WorkspaceProjectSwitcher` (F4) props match each view's call. `Task`/`AssigneeRow` (D1) feed `getTasks` (D1) and the Board/backlog views. `getSprints` (A6) reused by dashboard + backlog. `getWorkflow` (B2) reused by Board (D3).

**Dependency ordering:** `getTasks`+task actions (D1/D2) are required by `backlog` (B6) and Board (D3) — the plan flags this in B6 and orders Batch D's D1/D2 first. `getWorkspace`/`getWorkspaceMembers` (C1) feed C2.

---

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Board drag-drop snap-back / lost moves without react-query cache | `useOptimistic` applies instantly + auto-reverts on action throw; `revalidatePath('/board')` reconciles; Board's `initialTasks` `useEffect` resyncs refreshed props. Explicit drag verification (D3 Step 4). |
| Two selection sources (cookie vs zustand) during the sweep | Shared bridge (F4) mirrors both directions; removed in Phase 3. |
| Deferred self-fetching children break | Untouched; in-memory token stays alive (AuthBootstrap) for all of Phase 2; converted in Phase 3. |
| Avatar/attachment multipart vs JSON content-type | F2 omits default `Content-Type` for `FormData` bodies. |
| `meta` lost via `serverFetch` (tasks assignees, notifications unread, admin paging) | `serverFetchEnvelope` (F2). |
| Async `params` mishandled on dynamic routes | C1–C3 shells `await params`; verified per task. |
| `revalidatePath('/', 'layout')` in `setSelection` is broad | Acceptable for the sweep; Phase 3 narrows to tags once the layout is RSC. |
| Large blast radius across ~21 routes | Batched gates (F→A→B→C→D), each ending green; one commit per route; Board isolated last. |

---

## Execution Handoff

Phase 2 plan saved to `docs/superpowers/plans/2026-05-20-csr-to-ssr-migration-phase2-sweep.md`.
