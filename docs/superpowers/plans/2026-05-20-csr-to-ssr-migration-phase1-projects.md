# CSR → SSR Migration — Phase 1 (Projects Vertical Slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the **Projects** page (`/projects`) end-to-end to the server-first pattern — async Server Component shell fetching via the DAL, a `'use client'` view receiving data as props, domain Server Actions for create/archive/delete, and the workspace selection cookie — proving and documenting the recipe the Phase 2 sweep will follow, **without breaking the other 10 pages that still read selection from zustand**.

**Architecture:** `page.tsx` becomes an `async` RSC: `requireSession()` → read `getSelection()` cookie → fetch workspaces + projects through `cache()`-wrapped DAL query helpers (`src/server/queries/*`) → render `projects-view.tsx` (`'use client'`) with data as props. Mutations call Server Actions in `src/server/actions/projects.ts` which `serverFetch` the API then `revalidatePath('/projects')`. Workspace switching writes the `pf_sel` cookie via the existing `setSelection` action (which revalidates and re-renders the server page). A **selection bridge** in the view keeps the legacy zustand `currentWorkspaceId` in sync so the not-yet-migrated pages keep working. No `@tanstack/react-query`, no in-memory token, no client `/api/v1` fetch on this route.

**Tech Stack:** Next.js 16 (App Router, RSC, async `cookies()`, Server Actions, `revalidatePath`), React 19 (`useTransition`), Hono backend (`apps/api`), Vitest.

**Spec:** `docs/superpowers/specs/2026-05-20-csr-to-ssr-migration-design.md` (§3.3 DAL, §3.4 actions, §3.5 page pattern, §7 Phase 1)
**Phase 0 plan (foundation this builds on):** `docs/superpowers/plans/2026-05-20-csr-to-ssr-migration-phase0.md`
**Branch:** `feat/csr-to-ssr-phase1-projects` (off `main`)

---

## ⚠️ Next.js 16 caveat (read first)

`apps/next-web/AGENTS.md`: *"This is NOT the Next.js you know… Read the relevant guide in `node_modules/next/dist/docs/` before writing any code."* Two APIs this plan relies on must be confirmed against the installed version before use:

1. **`unstable_rethrow` from `next/navigation`** — used in Server Action `catch` blocks so a `redirect()`/`notFound()` thrown by `serverFetch` (on 401) propagates instead of being swallowed as an error string. Verify it exists: `grep -r "unstable_rethrow" apps/next-web/node_modules/next/dist/`. If absent in this version, fall back to the documented redirect-error guard (`isRedirectError`) and adjust the catch blocks accordingly.
2. **`revalidatePath` from `next/cache`** — already used in `src/server/actions/selection.ts` (Phase 0), so it is confirmed available.

---

## Scope

**In scope (Phase 1):**
- DAL query helpers `getWorkspaces()` and `getProjects(workspaceId)` + a **pure** normalization module (centralizes the PascalCase/camelCase mapping currently duplicated inline).
- Project domain Server Actions: `createProject`, `archiveProject`, `deleteProject`.
- Convert `src/app/(app)/projects/page.tsx` to an async Server Component.
- New `src/app/(app)/projects/projects-view.tsx` (`'use client'`) holding the existing UI, fed by props + actions.
- `src/app/(app)/projects/loading.tsx` skeleton.
- Selection bridge: workspace switch writes the cookie via `setSelection` **and** mirrors into zustand; first migrated visit seeds the cookie from legacy localStorage.
- Recipe doc for the Phase 2 sweep.

**Out of scope (later phases):**
- Any other page (dashboard, board, epics, roadmap, backlog, workspaces, versions, workflows, automations, project-settings, TaskDrawer) — they keep reading zustand selection unchanged. Phase 2.
- Removing react-query, `providers.tsx`, `AuthBootstrap`, or zustand selection — Phase 3.
- Converting the `(app)` layout / sidebar / `Layout1` to RSC — Phase 2/3. The migrated Projects Server Component renders fine as `children` of the existing client layout (RSC composition).
- Project **settings** subroute (`projects/[id]/settings`) — Phase 2.

---

## File Structure

**Create**
- `apps/next-web/src/server/queries/normalize.ts` — pure `Workspace`/`Project` types + `normalizeWorkspace`/`normalizeProject` (one responsibility: shape mapping; no I/O, no `server-only`).
- `apps/next-web/src/server/queries/__tests__/normalize.test.ts` — unit tests for the above.
- `apps/next-web/src/server/queries/workspaces.ts` — `getWorkspaces()` (`server-only`, `cache()`).
- `apps/next-web/src/server/queries/projects.ts` — `getProjects(workspaceId)` (`server-only`, `cache()`).
- `apps/next-web/src/server/actions/projects.ts` — `createProject`/`archiveProject`/`deleteProject` Server Actions.
- `apps/next-web/src/app/(app)/projects/projects-view.tsx` — `'use client'` view (interactivity only).
- `apps/next-web/src/app/(app)/projects/loading.tsx` — route skeleton.

**Modify**
- `apps/next-web/src/app/(app)/projects/page.tsx` — replace the entire client component with an async Server Component shell.

> Unit tests cover only the pure module (`normalize`); modules that `import 'server-only'` or run in the Next request scope (queries, actions, page) are verified by the manual end-to-end task (Task 7), matching the Phase 0 convention (avoids `server-only` throwing under Vitest).

---

## Task 1: Pure normalization module (TDD)

**Files:**
- Create: `apps/next-web/src/server/queries/normalize.ts`
- Test: `apps/next-web/src/server/queries/__tests__/normalize.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/next-web/src/server/queries/__tests__/normalize.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeWorkspace, normalizeProject } from '../normalize';

describe('normalizeWorkspace', () => {
  it('reads PascalCase fields', () => {
    expect(normalizeWorkspace({ Id: 'w1', Name: 'Acme' })).toEqual({ id: 'w1', name: 'Acme' });
  });
  it('reads camelCase fields', () => {
    expect(normalizeWorkspace({ id: 'w2', name: 'Beta' })).toEqual({ id: 'w2', name: 'Beta' });
  });
});

describe('normalizeProject', () => {
  it('maps PascalCase API rows to a stable camelCase shape', () => {
    expect(
      normalizeProject({
        Id: 'p1', Name: 'Web', Key: 'WEB', Description: 'site',
        Type: 'KANBAN', Status: 'ACTIVE', CreatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toEqual({
      id: 'p1', name: 'Web', key: 'WEB', description: 'site',
      type: 'KANBAN', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z',
    });
  });
  it('maps camelCase rows too', () => {
    const p = normalizeProject({ id: 'p2', name: 'App', key: 'APP', type: 'SCRUM', status: 'ARCHIVED' });
    expect(p).toMatchObject({ id: 'p2', name: 'App', key: 'APP', type: 'SCRUM', status: 'ARCHIVED' });
  });
  it('applies safe defaults for missing fields', () => {
    const p = normalizeProject({ Id: 'p3' });
    expect(p).toEqual({
      id: 'p3', name: '(unnamed)', key: '—', description: null,
      type: 'KANBAN', status: 'ACTIVE', createdAt: null,
    });
  });
  it('coerces empty/blank description and createdAt to null', () => {
    const p = normalizeProject({ Id: 'p4', Description: '', CreatedAt: '' });
    expect(p.description).toBeNull();
    expect(p.createdAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/next-web && npx vitest run src/server/queries/__tests__/normalize.test.ts`
Expected: FAIL — `Cannot find module '../normalize'`.

- [ ] **Step 3: Implement**

```ts
// apps/next-web/src/server/queries/normalize.ts
// Pure shape mapping for API rows. The API returns PascalCase from some
// endpoints and camelCase from others; every page used to re-do `raw.Id ?? raw.id`
// inline. Centralizing it here is the normalization the DAL owns (spec §3.3).
export interface Workspace {
  id: string;
  name: string;
}

export type ProjectType = 'KANBAN' | 'SCRUM' | 'BUSINESS';
export type ProjectStatus = 'ACTIVE' | 'ARCHIVED' | 'DELETED';

export interface Project {
  id: string;
  name: string;
  key: string;
  description: string | null;
  type: ProjectType;
  status: ProjectStatus;
  createdAt: string | null;
}

/** Non-empty string or null. */
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export function normalizeWorkspace(raw: any): Workspace {
  return {
    id: String(raw?.Id ?? raw?.id ?? ''),
    name: String(raw?.Name ?? raw?.name ?? ''),
  };
}

export function normalizeProject(raw: any): Project {
  return {
    id:          String(raw?.Id ?? raw?.id ?? ''),
    name:        String(raw?.Name ?? raw?.name ?? '(unnamed)'),
    key:         String(raw?.Key ?? raw?.key ?? '—'),
    description: str(raw?.Description ?? raw?.description),
    type:        String(raw?.Type ?? raw?.type ?? 'KANBAN') as ProjectType,
    status:      String(raw?.Status ?? raw?.status ?? 'ACTIVE') as ProjectStatus,
    createdAt:   str(raw?.CreatedAt ?? raw?.createdAt),
  };
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd apps/next-web && npx vitest run src/server/queries/__tests__/normalize.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/next-web/src/server/queries/normalize.ts apps/next-web/src/server/queries/__tests__/normalize.test.ts
git commit -m "feat(next-web): add pure project/workspace normalization for the DAL"
```

---

## Task 2: DAL query helpers (`getWorkspaces`, `getProjects`)

**Files:**
- Create: `apps/next-web/src/server/queries/workspaces.ts`
- Create: `apps/next-web/src/server/queries/projects.ts`

- [ ] **Step 1: Implement `getWorkspaces`**

```ts
// apps/next-web/src/server/queries/workspaces.ts
import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';
import { normalizeWorkspace, type Workspace } from './normalize';

/** All workspaces for the current session, normalized. Deduped per render. */
export const getWorkspaces = cache(async (): Promise<Workspace[]> => {
  const data = await serverFetch<any[]>('/workspaces');
  return (data ?? []).map(normalizeWorkspace);
});
```

- [ ] **Step 2: Implement `getProjects`**

```ts
// apps/next-web/src/server/queries/projects.ts
import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';
import { normalizeProject, type Project } from './normalize';

/** Projects in a workspace, normalized. Deduped per render. */
export const getProjects = cache(async (workspaceId: string): Promise<Project[]> => {
  const data = await serverFetch<any[]>(`/projects?workspaceId=${encodeURIComponent(workspaceId)}`);
  return (data ?? []).map(normalizeProject);
});
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/next-web && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/next-web/src/server/queries/workspaces.ts apps/next-web/src/server/queries/projects.ts
git commit -m "feat(next-web): add getWorkspaces/getProjects DAL queries"
```

---

## Task 3: Project domain Server Actions

**Files:**
- Create: `apps/next-web/src/server/actions/projects.ts`

`serverFetch` (Phase 0) throws a plain `Error` on non-OK and calls `redirect('/login')` on 401. `redirect()` throws a control-flow error that **must not** be swallowed — `unstable_rethrow(e)` re-throws it before we convert other errors to a result string (see the Next 16 caveat above).

- [ ] **Step 1: Implement**

```ts
// apps/next-web/src/server/actions/projects.ts
'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import type { ProjectType } from '../queries/normalize';

export type ActionResult = { ok: true } | { ok: false; error: string };

export interface CreateProjectInput {
  workspaceId: string;
  name: string;
  key: string;
  type: ProjectType;
  description: string;
}

export async function createProject(input: CreateProjectInput): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch('/projects', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: input.workspaceId,
        name: input.name,
        key: input.key,
        type: input.type,
        description: input.description || null,
      }),
    });
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: e instanceof Error ? e.message : 'Create failed' };
  }
  revalidatePath('/projects');
  return { ok: true };
}

export async function archiveProject(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/projects/${encodeURIComponent(id)}/archive`, { method: 'POST' });
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: e instanceof Error ? e.message : 'Archive failed' };
  }
  revalidatePath('/projects');
  return { ok: true };
}

export async function deleteProject(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: e instanceof Error ? e.message : 'Delete failed' };
  }
  revalidatePath('/projects');
  return { ok: true };
}
```

- [ ] **Step 2: Confirm `unstable_rethrow` exists in this Next version**

Run: `cd apps/next-web && grep -rl "unstable_rethrow" node_modules/next/dist/ | head -1`
Expected: at least one match. If none, replace each `unstable_rethrow(e);` with:
```ts
import { isRedirectError } from 'next/dist/client/components/redirect-error';
// …in catch: if (isRedirectError(e)) throw e;
```
(verify that path against `node_modules/next/dist/` first).

- [ ] **Step 3: Typecheck**

Run: `cd apps/next-web && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/next-web/src/server/actions/projects.ts
git commit -m "feat(next-web): add project create/archive/delete server actions"
```

---

## Task 4: Projects client view (`projects-view.tsx`)

**Files:**
- Create: `apps/next-web/src/app/(app)/projects/projects-view.tsx`

This file holds the existing UI, now driven by props + Server Actions. **Move these helpers verbatim** from the current `page.tsx` into this file (they are presentational and unchanged): `TYPE_META`, `STATUS_META`, `suggestKey`, `CreateProjectDialog`, `KpiTile` (+ its `KpiTone` type), `EmptyState`. Delete the old inline `api()` helper and the `ApiProject`/`ProjectType`/`ProjectStatus` local types (types now come from `@/server/queries/normalize`). `ProjectCard` changes to consume a normalized `Project` (full code below). `ProjectsSkeleton` is **not** moved here — it becomes `loading.tsx` in Task 6.

- [ ] **Step 1: Write the view container, imports, and selection bridge**

```tsx
// apps/next-web/src/app/(app)/projects/projects-view.tsx
'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Folder, Plus, Search, Filter, X, LayoutGrid, Settings, Archive,
  Trash2, Briefcase, ArchiveX, Workflow, Kanban,
} from 'lucide-react';

import { useStore } from '@/store/useStore';
import { notifyApiError } from '@/lib/apiErrorToast';
import { setSelection } from '@/server/actions/selection';
import { createProject, archiveProject, deleteProject } from '@/server/actions/projects';
import type { Project, ProjectType, ProjectStatus, Workspace } from '@/server/queries/normalize';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// ── Lookup tables (moved verbatim from the old page.tsx) ──────────────────────
const TYPE_META: Record<ProjectType, { label: string; icon: typeof Kanban; cls: string }> = {
  KANBAN:   { label: 'Kanban',   icon: Kanban,   cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  SCRUM:    { label: 'Scrum',    icon: Workflow, cls: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300' },
  BUSINESS: { label: 'Business', icon: Briefcase,cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
};

const STATUS_META: Record<ProjectStatus, { label: string; cls: string }> = {
  ACTIVE:   { label: 'Active',   cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  ARCHIVED: { label: 'Archived', cls: 'bg-slate-100 text-slate-600  dark:bg-slate-800  dark:text-slate-400' },
  DELETED:  { label: 'Deleted',  cls: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
};

// Suggest a project key from a name: take initials, uppercase, max 4 chars.
function suggestKey(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!.slice(0, 4).toUpperCase();
  return parts.map((p) => p[0]).join('').slice(0, 4).toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────────────

export function ProjectsView({
  workspaces, projects, activeWorkspaceId, cookieWorkspaceId,
}: {
  workspaces: Workspace[];
  projects: Project[];
  activeWorkspaceId: string;
  cookieWorkspaceId: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [search,       setSearch]       = useState('');
  const [typeFilter,   setTypeFilter]   = useState<'ALL' | ProjectType>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ProjectStatus>('ALL');
  const [createOpen,   setCreateOpen]   = useState(false);
  const [createError,  setCreateError]  = useState<string | null>(null);

  // ── Selection bridge ────────────────────────────────────────────────────────
  // The cookie (pf_sel) is authoritative for migrated (server) pages; the other
  // 10 pages still read currentWorkspaceId from zustand. Keep them in sync until
  // Phase 3 removes zustand selection.
  const setCurrentWorkspace = useStore((s) => s.setCurrentWorkspace);
  const legacyWorkspaceId   = useStore((s) => s.currentWorkspaceId);

  useEffect(() => {
    // First migrated visit with an empty selection cookie: seed it from the
    // legacy localStorage selection, then refresh so the server renders that ws.
    if (
      cookieWorkspaceId === null &&
      legacyWorkspaceId &&
      legacyWorkspaceId !== activeWorkspaceId &&
      workspaces.some((w) => w.id === legacyWorkspaceId)
    ) {
      startTransition(async () => {
        await setSelection({ workspaceId: legacyWorkspaceId });
        router.refresh();
      });
      return;
    }
    // Otherwise make zustand reflect the cookie/server truth for legacy pages.
    if (legacyWorkspaceId !== activeWorkspaceId) setCurrentWorkspace(activeWorkspaceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, cookieWorkspaceId]);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0];

  function switchWorkspace(id: string) {
    setCurrentWorkspace(id);                 // legacy pages
    startTransition(async () => {
      await setSelection({ workspaceId: id }); // cookie → revalidate → server re-render
    });
  }

  // ── Mutations via Server Actions ─────────────────────────────────────────────
  function handleCreate(input: { name: string; key: string; type: ProjectType; description: string }) {
    setCreateError(null);
    startTransition(async () => {
      const res = await createProject({ workspaceId: activeWorkspaceId, ...input });
      if (res.ok) setCreateOpen(false);
      else setCreateError(res.error);
    });
  }

  function handleArchive(p: Project) {
    if (p.status === 'ARCHIVED') return;
    if (!window.confirm(`Archive ${p.name}?\n\nArchived projects stay readable but won't appear in switchers by default.`)) return;
    startTransition(async () => {
      const res = await archiveProject(p.id);
      if (!res.ok) notifyApiError({ error: { message: res.error } }, 0);
    });
  }

  function handleDelete(p: Project) {
    if (!window.confirm(`Delete ${p.name}?\n\nThis soft-deletes the project. All its issues, sprints, and workflow stay in the database but become invisible.`)) return;
    startTransition(async () => {
      const res = await deleteProject(p.id);
      if (!res.ok) notifyApiError({ error: { message: res.error } }, 0);
    });
  }

  // ── Filter pipeline (normalized fields) ──────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (typeFilter   !== 'ALL' && p.type   !== typeFilter)   return false;
      if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
      if (q) {
        const hay = `${p.name} ${p.key} ${p.description ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [projects, search, typeFilter, statusFilter]);

  const kpi = useMemo(() => ({
    total:    projects.length,
    active:   projects.filter((p) => p.status === 'ACTIVE').length,
    archived: projects.filter((p) => p.status === 'ARCHIVED').length,
    kanban:   projects.filter((p) => p.type === 'KANBAN').length,
  }), [projects]);

  const activeFilterCount =
    (typeFilter   !== 'ALL' ? 1 : 0) +
    (statusFilter !== 'ALL' ? 1 : 0) +
    (search.trim() ? 1 : 0);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col gap-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Folder className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Projects</span>
              {activeWorkspace?.name && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{activeWorkspace.name}</span>
                </>
              )}
            </div>
            <h2 className="text-base font-semibold text-foreground truncate">Manage projects</h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {workspaces.length > 1 && (
            <Select value={activeWorkspaceId} onValueChange={switchWorkspace}>
              <SelectTrigger className="h-8 w-[200px] text-xs">
                <SelectValue placeholder="Workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>{ws.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)} disabled={!activeWorkspaceId}>
            <Plus className="size-4" /> New project
          </Button>
        </div>
      </div>

      {/* ── KPI tiles ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile icon={Folder}   label="Total projects" value={kpi.total}    tone="default" />
        <KpiTile icon={Workflow} label="Active"         value={kpi.active}   tone="success" />
        <KpiTile icon={ArchiveX} label="Archived"       value={kpi.archived} tone="muted" />
        <KpiTile icon={Kanban}   label="Kanban boards"  value={kpi.kanban}   tone="info" />
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, key, or description…"
            className="h-8 pl-7 text-xs"
            aria-label="Filter projects"
          />
        </div>

        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as 'ALL' | ProjectType)}>
          <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All types</SelectItem>
            {(Object.keys(TYPE_META) as ProjectType[]).map((t) => (
              <SelectItem key={t} value={t}>{TYPE_META[t].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'ALL' | ProjectStatus)}>
          <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="ARCHIVED">Archived</SelectItem>
          </SelectContent>
        </Select>

        {activeFilterCount > 0 && (
          <>
            <Badge variant="outline" size="sm" appearance="outline" className="ml-1">
              <Filter className="size-3" /> {activeFilterCount}
            </Badge>
            <Button
              size="sm" variant="ghost"
              onClick={() => { setSearch(''); setTypeFilter('ALL'); setStatusFilter('ALL'); }}
              className="h-8 px-2 text-xs"
            >
              <X className="size-3.5" /> Clear
            </Button>
          </>
        )}

        <div className="ml-auto text-xs text-muted-foreground">
          Showing <strong className="text-foreground">{filtered.length}</strong> of <strong className="text-foreground">{projects.length}</strong>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      {projects.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          No projects match the current filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              busy={isPending}
              onArchive={() => handleArchive(p)}
              onDelete={() => handleDelete(p)}
            />
          ))}
        </div>
      )}

      <CreateProjectDialog
        open={createOpen}
        onClose={() => { setCreateOpen(false); setCreateError(null); }}
        onSubmit={handleCreate}
        isPending={isPending}
        error={createError}
      />
    </div>
  );
}
```

- [ ] **Step 2: Add the updated `ProjectCard` (consumes a normalized `Project`)**

```tsx
// projects-view.tsx — append below ProjectsView
function ProjectCard({
  project, onArchive, onDelete, busy,
}: {
  project: Project;
  onArchive: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const { id, name, key, description: desc, type, status, createdAt } = project;
  const tm = TYPE_META[type] ?? TYPE_META.KANBAN;
  const sm = STATUS_META[status] ?? STATUS_META.ACTIVE;
  const TypeIcon = tm.icon;

  return (
    <Card className={cn('p-4 flex flex-col gap-3', status !== 'ACTIVE' && 'opacity-70')}>
      <div className="flex items-start gap-3">
        <span className={cn('inline-flex size-9 items-center justify-center rounded-md shrink-0', tm.cls)}>
          <TypeIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate">{name}</h3>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{key}</span>
            <span aria-hidden="true">·</span>
            <Badge size="xs" variant="outline" appearance="outline" className="font-normal">{tm.label}</Badge>
            <Badge size="xs" variant="outline" appearance="outline" className={cn('font-normal', sm.cls)}>{sm.label}</Badge>
          </div>
        </div>
      </div>

      {desc && (
        <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">{desc}</p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/40">
        <Link href="/board" className="contents">
          <Button size="sm" variant="outline"><LayoutGrid className="size-3.5" /> Open board</Button>
        </Link>
        <Link href={`/projects/${id}/settings`} className="contents">
          <Button size="sm" variant="ghost"><Settings className="size-3.5" /> Settings</Button>
        </Link>
        {status === 'ACTIVE' && (
          <Button size="sm" variant="ghost" onClick={onArchive} disabled={busy} aria-label={`Archive ${name}`}>
            <Archive className="size-3.5" />
          </Button>
        )}
        <Button
          size="sm" variant="ghost"
          className="text-destructive hover:text-destructive ml-auto"
          onClick={onDelete} disabled={busy} aria-label={`Delete ${name}`}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {createdAt && (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-mono">
          Created {new Date(createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
      )}
    </Card>
  );
}
```

- [ ] **Step 3: Move the unchanged helpers**

Copy `CreateProjectDialog`, `KpiTile` (and its `KpiTone` type), and `EmptyState` **verbatim** from the current `page.tsx` (lines 451–645) into `projects-view.tsx` below `ProjectCard`. They reference only `TYPE_META`, `suggestKey`, and `ui/*` imports already present in this file — no edits needed. Do **not** copy `ProjectsSkeleton` (it becomes `loading.tsx` in Task 6).

- [ ] **Step 4: Typecheck**

Run: `cd apps/next-web && npx tsc --noEmit`
Expected: no errors. (`page.tsx` still imports nothing from here yet — it is replaced in Task 5.)

- [ ] **Step 5: Commit**

```bash
git add "apps/next-web/src/app/(app)/projects/projects-view.tsx"
git commit -m "feat(next-web): add Projects client view driven by props + server actions"
```

---

## Task 5: Convert `page.tsx` to an async Server Component

**Files:**
- Modify: `apps/next-web/src/app/(app)/projects/page.tsx` (replace the **entire** file)

- [ ] **Step 1: Replace the whole file**

```tsx
// apps/next-web/src/app/(app)/projects/page.tsx
import { redirect } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getSelection } from '@/server/selection';
import { getWorkspaces } from '@/server/queries/workspaces';
import { getProjects } from '@/server/queries/projects';
import { ProjectsView } from './projects-view';

export default async function ProjectsPage() {
  await requireSession();

  const workspaces = await getWorkspaces();
  if (workspaces.length === 0) redirect('/setup');

  const { workspaceId: cookieWorkspaceId } = await getSelection();
  // Trust the cookie only if it still points at a workspace the user has.
  const activeWorkspaceId =
    cookieWorkspaceId && workspaces.some((w) => w.id === cookieWorkspaceId)
      ? cookieWorkspaceId
      : workspaces[0]!.id;

  const projects = await getProjects(activeWorkspaceId);

  return (
    <ProjectsView
      workspaces={workspaces}
      projects={projects}
      activeWorkspaceId={activeWorkspaceId}
      cookieWorkspaceId={cookieWorkspaceId}
    />
  );
}
```

- [ ] **Step 2: Confirm no react-query / client fetch remains on this route**

Run: `cd apps/next-web && grep -rn "@tanstack/react-query\|fetch('/api/v1\|use client" "src/app/(app)/projects/page.tsx"`
Expected: **no output** (the page is a pure Server Component; client concerns live in `projects-view.tsx`).

- [ ] **Step 3: Typecheck + build**

Run: `cd apps/next-web && npx tsc --noEmit && npm run build`
Expected: build succeeds; `/projects` builds without error.

- [ ] **Step 4: Commit**

```bash
git add "apps/next-web/src/app/(app)/projects/page.tsx"
git commit -m "feat(next-web): convert Projects page to async server component (RSC slice)"
```

---

## Task 6: Route skeleton (`loading.tsx`)

**Files:**
- Create: `apps/next-web/src/app/(app)/projects/loading.tsx`

Provides the skeleton Next shows while the Server Component awaits data, replacing the old in-component `ProjectsSkeleton`. `ui/skeleton` is a styled `div` (no client hooks), so it renders fine in this Server Component.

- [ ] **Step 1: Implement**

```tsx
// apps/next-web/src/app/(app)/projects/loading.tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="flex h-full flex-col gap-4">
      <Skeleton className="h-9 w-64 rounded-lg" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
      <Skeleton className="h-12 rounded-lg" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Confirm `ui/skeleton` renders inside an RSC**

Run: `cd apps/next-web && head -1 src/components/ui/skeleton.tsx`
Expected: a plain component. If it is `'use client'`, that is fine — leave the import as-is (a client component renders inside a Server Component).

- [ ] **Step 3: Typecheck**

Run: `cd apps/next-web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/next-web/src/app/(app)/projects/loading.tsx"
git commit -m "feat(next-web): add Projects route loading skeleton"
```

---

## Task 7: End-to-end verification

**Files:** none (verification only)

Prereq: API (`apps/api`) running with DB/Redis and `BFF_SECRET` set in both `.env` files; Next dev (`cd apps/next-web && npm run dev`); a seeded user with ≥1 workspace (ideally 2, to test switching).

- [ ] **Step 1: Server-rendered first paint**
  - Log in, visit `/projects`. View-source (Ctrl+U) shows project names/keys in the initial HTML (not an empty shell) — confirms RSC data fetch.
  - No full-screen loader flash beyond the `loading.tsx` skeleton.

- [ ] **Step 2: Create**
  - Click **New project**, fill name/key/type, submit. Dialog closes; the new card appears **without a manual reload** (`revalidatePath('/projects')`). A duplicate key surfaces the API error in the dialog.

- [ ] **Step 3: Archive / Delete**
  - Archive an ACTIVE project → its badge flips to Archived after the action resolves. Delete a project → it disappears. Failures raise a toast (`notifyApiError`).

- [ ] **Step 4: Workspace switch writes the cookie**
  - With 2+ workspaces, switch via the dropdown. The list re-renders server-side for the new workspace. DevTools → Application → Cookies → `pf_sel` shows `{"workspaceId":"…","projectId":…}`, `HttpOnly`, `Path=/`.

- [ ] **Step 5: Selection bridge keeps legacy pages in sync**
  - After switching workspace on `/projects`, navigate to a **non-migrated** page (e.g. `/epics` or `/board`). It shows the **same** workspace's data (zustand mirror updated by `switchWorkspace`).
  - Reverse: on a legacy page switch workspace, then return to `/projects` — it reflects the new workspace (first-visit cookie seed / alignment effect).

- [ ] **Step 6: Auth boundary**
  - Delete `pf_at` + `pf_rt`, hard-reload `/projects` → redirected to `/login` (proxy + `requireSession`).

- [ ] **Step 7: Suite + build green**

Run: `cd apps/next-web && npm run build && npx vitest run`
Expected: build succeeds; all unit tests PASS (incl. `normalize.test.ts`).

- [ ] **Step 8: Commit (empty marker if nothing changed)**

```bash
git commit -m "chore(ssr): Phase 1 Projects vertical slice verified" --allow-empty
```

---

## Task 8: Document the recipe for the Phase 2 sweep

**Files:**
- Create: `docs/superpowers/recipes/rsc-page-migration.md`

- [ ] **Step 1: Write the recipe**

````markdown
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
````

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/recipes/rsc-page-migration.md
git commit -m "docs(ssr): add RSC page-migration recipe from the Projects slice"
```

---

## Self-Review

- **Spec coverage:** Phase 1 = "Migrate Projects (list read + create/archive/delete + workspace selection cookie) fully to Server shell + Server Actions + revalidate; lock the pattern, write tests, document the recipe" (spec §7).
  - List read → DAL queries (Task 2) + page (Task 5). ✓
  - create/archive/delete → actions (Task 3) + view wiring (Task 4). ✓
  - workspace selection cookie → `setSelection` reuse + bridge (Task 4) + page read (Task 5). ✓
  - Server shell + Client view → Tasks 5 + 4; `loading.tsx` → Task 6. ✓
  - revalidate → `revalidatePath('/projects')` in actions; `revalidatePath('/', 'layout')` in `setSelection`. ✓
  - tests → `normalize.test.ts` (Task 1) + E2E (Task 7). ✓
  - document the recipe → Task 8. ✓
  - DAL normalization centralization (spec §3.3) → Task 1. ✓
- **Coexistence (not in the spec's per-phase detail, decided here):** the spec defers zustand-selection removal to Phase 3, so during Phase 1 both stores exist. The selection bridge (Task 4) is the explicit mechanism; documented as a risk below — not silently dropped.
- **Placeholder scan:** no TBD/"handle errors"/"similar to". Unchanged presentational components are an explicit verbatim **move** of code that exists in the source file being split (Task 4 Step 3), with exact line references — not a placeholder.
- **Type consistency:** `Workspace`/`Project`/`ProjectType`/`ProjectStatus` defined in Task 1 and imported unchanged in Tasks 2–5. `ActionResult`/`CreateProjectInput` defined in Task 3, consumed in Task 4. `ProjectsView` prop shape (Task 4) matches exactly what `page.tsx` passes (Task 5): `workspaces`, `projects`, `activeWorkspaceId`, `cookieWorkspaceId`. `getProjects(workspaceId)` / `getWorkspaces()` signatures match their call sites. ✓

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Two sources of selection truth (cookie vs zustand) during Phase 1/2 | Selection bridge (Task 4): switches write both; first migrated visit seeds the cookie from localStorage. Removed in Phase 3 when zustand selection is deleted. |
| First visit with empty `pf_sel` shows `workspaces[0]` before the seed effect refreshes | Self-healing within one `router.refresh()`; only on the very first migrated visit. Documented in Task 7 Step 5. |
| `unstable_rethrow` not present in this Next build | Task 3 Step 2 verifies it and gives the `isRedirectError` fallback. |
| `revalidatePath('/', 'layout')` in `setSelection` is broad (revalidates everything) | Acceptable for the slice; Phase 2 can narrow to tags once more pages are server-rendered. |
| Archive/delete use a shared `isPending` (coarser than per-row) | Acceptable UX for the slice; buttons disable during any pending action. |

---

## Execution Handoff

Phase 1 plan saved to `docs/superpowers/plans/2026-05-20-csr-to-ssr-migration-phase1-projects.md`.
