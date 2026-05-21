# CSR→SSR Migration — Phase 3 (Teardown) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the CSR→SSR migration by converting every remaining self-fetching client component off `@tanstack/react-query` + the in-memory access token, then deleting the AuthBootstrap gate, the QueryClient, the in-memory auth in `useStore.ts`, the selection bridge, and the client `/api/v1` rewrite.

**Architecture:** Conversions first, deletions last. Each deferred self-fetching child keeps `'use client'` but swaps `useQuery`→a Server Action called in a `useTransition` (or initial data via props) and `useMutation`→a Server Action + `revalidatePath`/local refetch. The `(app)` layout shell becomes an RSC that derives `isAdmin` server-side and passes it down. Once two grep counts hit zero (`@tanstack/react-query` imports; client `accessToken`/`fetch('/api/v1'`), the auth/query infrastructure is deleted.

**Tech Stack:** Next.js 16 (App Router, **Proxy** not Middleware, async `cookies()`), React 19 (`useActionState`/`useTransition`/`useOptimistic`), Server Actions, the Phase 2 DAL (`src/server/api.ts` `serverFetch`/`serverFetchEnvelope`/`serverFetchBody`, `src/server/actions/result.ts` `ActionResult`, `src/server/actions/error.ts` `toActionError`, `src/lib/apiErrorToast.ts` `notifyActionError`), vitest.

> ⚠️ **Next 16 caveat (`apps/next-web/AGENTS.md`):** "This is NOT the Next.js you know." Before touching any Next API, check `node_modules/next/dist/docs/`.

---

## Reference: the Phase 2 conversion recipe (read once, reuse every batch)

Every conversion in Batches G–I follows the **same shape** the Phase 2 sweep locked in. The detailed worked example is **Task G1 (CommentSection)** below — read it once; later tasks are precise deltas against it (their own endpoints + signatures), not re-derivations.

**Per self-fetching child:**
1. **Add a query helper** in `src/server/queries/<domain>.ts` — `import 'server-only'`; one `cache()`-wrapped async fn per read; call `serverFetch`/`serverFetchEnvelope`/`serverFetchBody` (pick by the endpoint's body shape — `{data}` envelope → `serverFetch`; `{data,meta}` → `serverFetchEnvelope`; raw `{xs:[...]}` → `serverFetchBody`); normalize PascalCase→camelCase here.
2. **Add an actions module** in `src/server/actions/<domain>.ts` — top of file `'use server'`; **never re-export the `ActionResult` type** (the `cdde8e2` Turbopack trap — it emits a runtime export and crashes the page); each mutation: `requireSession()` → `serverFetch(...)` → `revalidatePath(...)` (or return data) → `return` an `ActionResult<T>` via `toActionError` on failure.
3. **Convert the client component** — keep `'use client'`; delete `useQuery`/`useMutation`/`useQueryClient`/`useStore(... accessToken)`; replace reads with the action/query called inside `useTransition` on open (or accept `initial*` props), replace writes with the action + a local refetch or `router.refresh()`; surface errors via `notifyActionError`.
4. **Identity that came from `useStore(s => s.user)`** now comes from the server: pass `currentUserId` as a prop from the parent server component (or read `getSession()` where the parent is already RSC).

**Per-batch gate (MANDATORY — Phase 2 proved build-green ≠ correct):**
- `pnpm --filter next-web exec tsc --noEmit` → exit 0
- `pnpm --filter next-web exec vitest run` → all pass
- `pnpm --filter next-web build` → exit 0
- **Two-stage code review** (superpowers:requesting-code-review) — Phase 2 caught a real regression in nearly every task this way.
- **Interactive smoke** of the batch's surface in a running app (login → exercise each converted control). Build-green did NOT catch the Phase 2 `ReferenceError: ActionResult` or the broken login.

> Replace `pnpm --filter next-web` with the repo's actual runner if different — confirm in Task P1 Step 2.

---

## Preflight (Batch F0) — close Phase 2's gate and branch

### Task P0: Establish a green Phase 3 baseline

**Files:** none (git + verification only)

- [ ] **Step 1: Confirm working tree is clean except the smoke artifacts**

Run: `git -C d:/Project/ProjectFlow/ProjectFlow status --short`
Expected: only `?? docs/superpowers/plans/2026-05-20-csr-to-ssr-phase2-smoke-test.md` and `?? e2e/_smoke/` (plus this new plan + the spec edit). No tracked-file modifications outstanding from Phase 2.

- [ ] **Step 2: Commit the Phase 2 smoke-test artifacts**

```bash
git add e2e/_smoke docs/superpowers/plans/2026-05-20-csr-to-ssr-phase2-smoke-test.md
git commit -m "test(next-web): add Phase 2 interactive smoke-test scripts + run log"
```

- [ ] **Step 3: Place the Phase 2 `verified` marker (its gate was never formally closed)**

```bash
git commit --allow-empty -m "chore(ssr): Phase 2 full sweep verified"
```

- [ ] **Step 4: Create the Phase 3 branch**

```bash
git switch -c feat/csr-to-ssr-phase3-teardown
```

### Task P1: Capture the burn-down baseline (the objective gate for Batch K)

**Files:** none (read-only measurement)

- [ ] **Step 1: Record the starting counts** — these must reach the target before any deletion in Batch K.

Run (from repo root):
```bash
# A) react-query imports — TARGET 0
git grep -l "@tanstack/react-query" -- apps/next-web/src | wc -l
# B) client in-memory token refs — TARGET: only legit cookie/auth-exchange server files
git grep -n "accessToken\|setAuth\|clearAuth" -- apps/next-web/src
# C) client direct backend fetches — TARGET 0 in client components
git grep -n "fetch('/api/v1\|fetch(\`/api/v1\|/api/v1\${" -- apps/next-web/src
```
Expected baseline (2026-05-21): A) **13**; B) ~20 files; C) present in the components below.

- [ ] **Step 2: Confirm the runner command** used by Phase 2 (so every gate command in this plan is correct).

Run: `cat package.json | grep -A20 '"scripts"'` and check for a workspace runner (`pnpm`/`npm`/`turbo`). Use that exact form in all later gate steps.

- [ ] **Step 3: Confirm Phase 2 reusables exist** (Batches J/K depend on them):

Run:
```bash
git grep -n "getMyPermissions\|hasAdminAccess" -- apps/next-web/src/server/queries/admin.ts
git grep -n "export async function logout\|export const logout" -- apps/next-web/src/server/actions/auth.ts
```
Expected: `getMyPermissions`/`hasAdminAccess` present (added by Phase 2 commit `8c46295`); a `logout` action present (spec §4.3). **If `logout` is absent, add it in Task J2 before converting the dropdown.**

---

## Batch G — TaskDrawer children

Convert the four drawer sections off react-query/token. `TaskDrawer.tsx` itself also imports react-query (line 7) — after its children are converted, strip its own `useQuery`/`useQueryClient`/`useStore(accessToken)` (Task G5).

**Endpoint inventory (harvested from current code):**
| Component | Reads | Writes |
|-----------|-------|--------|
| CommentSection | `GET /comments?taskId=` | `POST /comments {taskId,body}` · `PATCH /comments/:id {body}` · `DELETE /comments/:id` · `POST /comments/:id/reactions {emoji}` |
| AttachmentSection | `GET /attachments?taskId=` | `POST /attachments` (FormData `taskId`,`file`) · `DELETE /attachments/:id` · `GET /attachments/:id/download → {data:{url}}` |
| WorkLogSection | `GET /worklogs?taskId=` | `POST /worklogs {taskId,timeSpentSeconds,...}` · `PATCH /worklogs/:id {timeSpentSeconds?,description?}` · `DELETE /worklogs/:id` |
| PullRequestsSection | `GET /git/pull-requests?taskId=` · `GET /git/commits?taskId=` | (read-only) |

### Task G1: CommentSection → Server Actions (the worked reference pattern)

**Files:**
- Create: `apps/next-web/src/server/queries/comments.ts`
- Create: `apps/next-web/src/server/actions/comments.ts`
- Modify: `apps/next-web/src/components/CommentSection.tsx` (currently lines 1–6, 44–127 are react-query/token)
- Modify (caller passes identity): `apps/next-web/src/components/TaskDrawer.tsx` (where `<CommentSection taskId=… />` is rendered)
- Test: `apps/next-web/src/server/queries/__tests__/comments.test.ts` (normalizer only, if normalization is non-trivial)

- [ ] **Step 1: Write the query helper**

```ts
// apps/next-web/src/server/queries/comments.ts
import 'server-only';
import { cache } from 'react';
import { serverFetch } from '@/server/api';

export interface Comment {
  id: string;
  authorId: string;
  authorName: string | null;
  authorAvatarUrl: string | null;
  body: string;
  isEdited: boolean;
  createdAt: string;
  reactions?: { emoji: string; count: number }[];
}

export const getComments = cache(async (taskId: string): Promise<Comment[]> => {
  return (await serverFetch<Comment[]>(`/comments?taskId=${encodeURIComponent(taskId)}`)) ?? [];
});
```

> Confirm the comments list body shape against `apps/api` (a `{data:[...]}` envelope → `serverFetch`; a raw `{comments:[...]}` → `serverFetchBody`). The current client read does `json.data ?? []`, i.e. an envelope → `serverFetch` is correct.

- [ ] **Step 2: Write the actions module**

```ts
// apps/next-web/src/server/actions/comments.ts
'use server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/server/session';
import { serverFetch } from '@/server/api';
import { toActionError } from '@/server/actions/error';
import type { ActionResult } from '@/server/actions/result'; // import only — DO NOT re-export

export async function addComment(taskId: string, body: string): Promise<ActionResult<void>> {
  try {
    await requireSession();
    await serverFetch('/comments', { method: 'POST', body: JSON.stringify({ taskId, body }) });
    revalidatePath('/board'); revalidatePath('/backlog');
    return { ok: true, data: undefined };
  } catch (e) { return toActionError(e); }
}

export async function editComment(id: string, body: string): Promise<ActionResult<void>> {
  try {
    await requireSession();
    await serverFetch(`/comments/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) });
    return { ok: true, data: undefined };
  } catch (e) { return toActionError(e); }
}

export async function deleteComment(id: string): Promise<ActionResult<void>> {
  try {
    await requireSession();
    await serverFetch(`/comments/${id}`, { method: 'DELETE' });
    return { ok: true, data: undefined };
  } catch (e) { return toActionError(e); }
}

export async function reactToComment(commentId: string, emoji: string): Promise<ActionResult<void>> {
  try {
    await requireSession();
    await serverFetch(`/comments/${commentId}/reactions`, { method: 'POST', body: JSON.stringify({ emoji }) });
    return { ok: true, data: undefined };
  } catch (e) { return toActionError(e); }
}
```

> Match the exact `ActionResult` shape already used by Phase 2 modules (open `src/server/actions/result.ts` and copy its discriminant — `{ ok: true, data } | { ok: false, error }` or similar). `serverFetch` sets JSON `Content-Type` for string bodies and omits it for FormData (Phase 2 fact F2), so don't add headers.

- [ ] **Step 3: Add a `loadComments` server wrapper for client refetch**

```ts
// append to apps/next-web/src/server/actions/comments.ts
export async function loadComments(taskId: string): Promise<Comment[]> {
  await requireSession();
  const { getComments } = await import('@/server/queries/comments');
  return getComments(taskId);
}
```
(Server *queries* can't be imported into a client component; this thin `'use server'` wrapper is how the converted component refetches.)

- [ ] **Step 4: Convert the component to call actions in a transition**

Replace `CommentSection.tsx` imports (1–6) and the react-query block (44–127). Keep ALL existing JSX (129–244) unchanged except: handler call sites move inside `start(...)`, and `currentUser?.id === c.authorId` becomes `currentUserId === c.authorId`.

```tsx
'use client';
import { useEffect, useState, useTransition } from 'react';
import { addComment, editComment, deleteComment, reactToComment, loadComments } from '@/server/actions/comments';
import { notifyActionError } from '@/lib/apiErrorToast';
import type { Comment } from '@/server/queries/comments';
import styles from './CommentSection.module.css';

export function CommentSection(
  { taskId, currentUserId, initialComments }:
  { taskId: string; currentUserId: string | null; initialComments?: Comment[] },
) {
  const [comments, setComments] = useState<Comment[]>(initialComments ?? []);
  const [pending, start] = useTransition();
  const [newBody, setNewBody] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');

  const refetch = () => loadComments(taskId).then(setComments);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (taskId) refetch(); }, [taskId]);

  const onAdd = (body: string) => start(async () => {
    const r = await addComment(taskId, body);
    if (!r.ok) return notifyActionError(r.error);
    setNewBody(''); await refetch();
  });
  // onEdit / onDelete / onReact follow the same shape, calling editComment / deleteComment / reactToComment.
  // ...existing JSX from current lines 129–244, with isLoading→(!comments.length && pending), and
  //    addMutation.isPending→pending, addMutation.mutate→onAdd, etc...
}
```

- [ ] **Step 5: Pass `currentUserId` from TaskDrawer**

In `TaskDrawer.tsx`, where `<CommentSection taskId={task.id} />` renders, pass `currentUserId`. For now take it from the drawer's existing `useStore(s => s.user)` (that read is removed in Task G5 once the id flows from the opener).

- [ ] **Step 6: Gate** — tsc + vitest + build (commands from Task P1 Step 2); fix to green.

- [ ] **Step 7: Commit**

```bash
git add apps/next-web/src/server/queries/comments.ts apps/next-web/src/server/actions/comments.ts apps/next-web/src/components/CommentSection.tsx apps/next-web/src/components/TaskDrawer.tsx
git commit -m "feat(next-web): convert CommentSection to Server Actions (drop react-query/token)"
```

### Task G2: WorkLogSection → Server Actions

**Files:** Create `src/server/queries/worklogs.ts` + `src/server/actions/worklogs.ts`; Modify `src/components/WorkLogSection.tsx` (uses `apiReq` helper + token, lines 85–131).

- [ ] **Steps 1–5:** Apply the G1 pattern with these signatures:
  - Query: `getWorkLogs(taskId): Promise<WorkLogListResult>` — copy the existing `WorkLogListResult` type from the component verbatim. The current `apiReq<WorkLogListResult>` returns the parsed body; **verify** whether a total/summary lives in `meta` — if so use `serverFetchEnvelope`, else `serverFetch`.
  - Actions: `addWorkLog(taskId, input: { timeSpentSeconds: number; description?: string; /* + any other current fields */ })` → `POST /worklogs`; `editWorkLog(id, input: { timeSpentSeconds?: number; description?: string })` → `PATCH /worklogs/:id`; `deleteWorkLog(id)` → `DELETE /worklogs/:id`; `loadWorkLogs(taskId)` thin wrapper.
  - Component: drop `apiReq` + token; same `useTransition`+`refetch` shape as G1; thread `currentUserId` if the worklog UI uses identity.
- [ ] **Step 6: Gate.** **Step 7: Commit** `feat(next-web): convert WorkLogSection to Server Actions`.

### Task G3: PullRequestsSection → Server query (read-only)

**Files:** Create `src/server/actions/git.ts` (two `'use server'` loaders); Modify `src/components/PullRequestsSection.tsx` (lines 13, 21 — two GETs that return `[]` on `!ok`).

- [ ] **Steps 1–5:** No mutations. Add loaders that preserve the current "silent empty on error" behavior:
  ```ts
  // apps/next-web/src/server/actions/git.ts
  'use server';
  import { requireSession } from '@/server/session';
  import { serverFetch } from '@/server/api';
  // copy PullRequest / Commit types from the component
  export async function getPullRequests(taskId: string) {
    try { await requireSession(); return (await serverFetch(`/git/pull-requests?taskId=${taskId}`)) ?? []; }
    catch { return []; }
  }
  export async function getCommits(taskId: string) {
    try { await requireSession(); return (await serverFetch(`/git/commits?taskId=${taskId}`)) ?? []; }
    catch { return []; }
  }
  ```
  Component: replace the two top-level `fetch` helpers with `useEffect`+`useTransition` calling these; keep existing render.
- [ ] **Step 6: Gate.** **Step 7: Commit** `feat(next-web): convert PullRequestsSection to server query`.

### Task G4: AttachmentSection → Server Actions (multipart upload + presigned download)

**Files:** Create `src/server/queries/attachments.ts` + `src/server/actions/attachments.ts`; Modify `src/components/AttachmentSection.tsx` (lines 47–119; PascalCase fields `Id/FileName/...`).

- [ ] **Step 1: Query** `getAttachments(taskId): Promise<Attachment[]>` → `GET /attachments?taskId=` (envelope `json.data`). Keep the PascalCase `Attachment` interface verbatim (API returns SP rows — do NOT rename fields).

- [ ] **Step 2: Upload action (FormData — the Phase 2 avatar precedent)**

```ts
// apps/next-web/src/server/actions/attachments.ts
'use server';
import { requireSession } from '@/server/session';
import { serverFetch } from '@/server/api';
import { toActionError } from '@/server/actions/error';
import type { ActionResult } from '@/server/actions/result'; // import only

export async function uploadAttachment(form: FormData): Promise<ActionResult<void>> {
  try {
    await requireSession();
    // serverFetch omits JSON Content-Type when body is FormData (Phase 2 fact F2 — verify in api.ts)
    await serverFetch('/attachments', { method: 'POST', body: form });
    return { ok: true, data: undefined };
  } catch (e) { return toActionError(e); }
}
```
Client builds `FormData` (`taskId`, `file`) and calls `uploadAttachment(form)` inside a transition; one call per file (preserve the per-file loop at line 100).

- [ ] **Step 3: Delete + download + refetch**
  - `deleteAttachment(id)` → `DELETE /attachments/:id`.
  - `getAttachmentDownloadUrl(id): Promise<ActionResult<{ url: string }>>` → `GET /attachments/:id/download`, return `{ ok:true, data:{ url: json.data.url } }`. Client: `const r = await getAttachmentDownloadUrl(a.Id); if (r.ok && r.data.url) window.open(r.data.url, '_blank', 'noopener,noreferrer');` (preserves the two-step signed-URL download).
  - `loadAttachments(taskId)` thin wrapper for refetch.

- [ ] **Step 4:** Convert the component (drop react-query/token; `useTransition`+`refetch`; keep dropzone JSX 127–204). **Step 5: Gate.** **Step 6: Commit** `feat(next-web): convert AttachmentSection to Server Actions (upload/download/delete)`.

### Task G5: Strip react-query/token from TaskDrawer itself

**Files:** Modify `src/components/TaskDrawer.tsx` (line 7 react-query import + any `useQuery`/`useStore(accessToken)` it still has after G1–G4).

- [ ] **Step 1:** Remove `@tanstack/react-query` import and any `useQuery`/`useQueryClient`. Whatever the drawer fetched itself (task detail/options) → a `loadTaskDetail`-style `'use server'` loader or props from the opener.
- [ ] **Step 2:** Remove `useStore(s => s.accessToken)`; identity → `currentUserId` prop threaded to children.
- [ ] **Step 3: Gate** (tsc/vitest/build).
- [ ] **Step 4: Two-stage review + interactive smoke** — open a card on `/board` and `/backlog`: comments load + add/edit/delete/react; attachments upload + download + delete; worklog add/edit/delete; PR/commits list renders.
- [ ] **Step 5: Commit** `refactor(next-web): drop react-query/in-memory token from TaskDrawer`.

> **Batch G gate:** `git grep -l "@tanstack/react-query" -- apps/next-web/src` count dropped by 5 (CommentSection, AttachmentSection, WorkLogSection, PullRequestsSection, TaskDrawer). Drawer fully exercised live.

---

## Batch H — Integration panels (project-settings tabs left self-fetching in B4)

**Endpoint inventory:**
| Component | Reads | Writes |
|-----------|-------|--------|
| WebhookManager | `GET /outgoing-webhooks` | `POST /outgoing-webhooks {workspaceId,...}` · `DELETE /outgoing-webhooks/:id` · `POST` ping/test |
| GitIntegrationSettings | `GET /git/connections` | `POST /git/connections {workspaceId,...}` · `DELETE /git/connections/:id` |
| SlackTeamsSettings | `GET /integrations` | `POST /integrations {workspaceId,...}` · `DELETE /integrations/:id` · `POST` test-delivery `{provider,webhookUrl}` |

> These render inside `projects/[id]/settings` (already an RSC shell from Phase 2 B4). Where the tab content is server-rendered, fetch the list **in the RSC page** and pass `initial*` as props (no on-open transition needed); use actions for mutations + `revalidatePath` on the page's literal route. `workspaceId` comes from the page's context as a prop, NOT `useStore`. The display-only receive-webhook URL strings (`/api/v1/webhooks/:provider`) stay plain strings — they are shown, not fetched.

### Task H1: WebhookManager → Server Actions
**Files:** Create `src/server/queries/webhooks.ts` + `src/server/actions/webhooks.ts`; Modify `src/components/WebhookManager.tsx` (local `api()` helper line 43; mutations 91–104; ping 199).
- [ ] Query `getOutgoingWebhooks(workspaceId)`; actions `createOutgoingWebhook(workspaceId, input)`, `deleteOutgoingWebhook(id)`, `pingWebhook(id): Promise<ActionResult<{ statusCode: number | null }>>` (feeds the existing ping status UI at 201–202). Apply the G1 conversion shape. Gate + commit `feat(next-web): convert WebhookManager to Server Actions`.

### Task H2: GitIntegrationSettings → Server Actions
**Files:** Create `src/server/queries/git-connections.ts` + `src/server/actions/git-connections.ts`; Modify `src/components/GitIntegrationSettings.tsx` (local `api()` line 27; mutations 95–108).
- [ ] Query `getGitConnections(workspaceId)`; actions `createGitConnection(workspaceId, input)`, `deleteGitConnection(id)`. Gate + commit `feat(next-web): convert GitIntegrationSettings to Server Actions`.

### Task H3: SlackTeamsSettings → Server Actions
**Files:** Create `src/server/queries/integrations.ts` + `src/server/actions/integrations.ts`; Modify `src/components/SlackTeamsSettings.tsx` (local `api()` line 77; mutations 118–131; test-delivery 299).
- [ ] Query `getIntegrations(workspaceId)`; actions `createIntegration(workspaceId, input)`, `deleteIntegration(id)`, `testIntegrationDelivery({ provider, webhookUrl })`. Gate + commit `feat(next-web): convert SlackTeamsSettings to Server Actions`.

> **Batch H gate:** the three integration files no longer import react-query/token; project-settings Git/Slack-Teams/Webhooks tabs created + deleted + tested live. Two-stage review.

---

## Batch I — Admin roles (the C6 deferral)

**Components:** `RolesTab.tsx`, `RoleEditorDialog.tsx`, `PermissionPicker.tsx`, and the inline `UserRolesDialog` in `admin-view.tsx` (lines ~970–1045; `apiFetch` helper at 972; react-query import at line 6).

**Endpoint inventory:**
| Surface | Reads | Writes |
|---------|-------|--------|
| RolesTab | `GET /admin/roles` | (delegates to editor) |
| RoleEditorDialog | role detail | `POST /admin/roles {name,description,scope,...}` · `PATCH /admin/roles/:id {name,description}` · `PUT /admin/roles/:id/permissions {permissionIds}` · `DELETE /admin/roles/:id` |
| PermissionPicker | `GET /admin/permissions` (verify path) | — |
| UserRolesDialog (in admin-view) | `GET /admin/user-roles/:userId` · `GET /admin/roles` · `GET /admin/workspaces?page=1&pageSize=200` | `POST /admin/user-roles/:userId {roleId,workspaceId}` · `DELETE /admin/user-roles/:userId/:roleId?workspaceId=` |

### Task I1: Admin roles/permissions query + actions modules
**Files:** Create `src/server/queries/admin-roles.ts` + `src/server/actions/admin-roles.ts`. (Co-locate with the Phase 2 `queries/admin.ts`; keep roles in a separate file to stay focused.)
- [ ] Queries: `getRoles()` (`/admin/roles`), `getPermissions()` (`/admin/permissions` — verify), `getUserRoleAssignments(userId)` (`/admin/user-roles/:userId`), `getAllWorkspacesForRoles()` (`/admin/workspaces?page=1&pageSize=200`).
- [ ] Actions: `createRole(input)`, `updateRole(id, { name, description })`, `setRolePermissions(id, permissionIds: string[])` (`PUT`), `deleteRole(id)`, `assignUserRole(userId, { roleId, workspaceId })`, `revokeUserRole(userId, roleId, workspaceId: string | null)`. Each `revalidatePath('/admin')`. Gate + commit `feat(next-web): admin-roles DAL + actions`.

### Task I2: Convert RolesTab + RoleEditorDialog + PermissionPicker
**Files:** Modify `src/components/admin/RolesTab.tsx`, `RoleEditorDialog.tsx`, `PermissionPicker.tsx`.
- [ ] Apply the G1 pattern (transition + refetch via I1 loaders; mutations via I1 actions; `notifyActionError`). Drop each file's local `api()`/`fetch` helper + token. Gate + commit `refactor(next-web): convert admin RolesTab/RoleEditorDialog/PermissionPicker off react-query`.

### Task I3: Convert UserRolesDialog inside admin-view + strip admin-view react-query
**Files:** Modify `src/app/(app)/admin/admin-view.tsx` (line 6 import; inline dialog 970–1045; `apiFetch` 972).
- [ ] Convert the inline dialog to the I1 loaders/actions; remove the `@tanstack/react-query` import and `apiFetch`/token from `admin-view.tsx`. (Extracting `UserRolesDialog` into `components/admin/UserRolesDialog.tsx` is optional cleanup — only if admin-view is unwieldy.) Gate.
- [ ] **Two-stage review + interactive smoke** with an admin account: create/edit/delete a role, edit its permissions, assign + revoke a user-role. Commit `refactor(next-web): convert admin-view UserRolesDialog off react-query`.

> **Batch I gate:** `admin-view.tsx` and `components/admin/*` free of react-query/token; roles + user-role flows exercised live with an admin account.

---

## Batch J — Layout shell → RSC

### Task J1: `(app)` layout derives `isAdmin` server-side; sidebar gate moves off the client fetch
**Files:** Modify `src/app/(app)/layout.tsx`, `src/components/layouts/layout-1/components/sidebar-menu.tsx` (client fetch of `/api/v1/auth/me/permissions`, lines 32–43).
- [ ] **Step 1:** In the `(app)` layout (RSC), call `hasAdminAccess()` (Phase 2, `server/queries/admin.ts`) and pass `isAdmin` down to whatever component renders `SidebarMenu`.
- [ ] **Step 2:** In `sidebar-menu.tsx`, delete `useStore(accessToken)` + the `useEffect` fetch + `useState(isAdmin)`; accept `isAdmin: boolean` as a prop; keep the existing `MENU_SIDEBAR.filter(item => item.path !== '/admin' || isAdmin)`. Removes the Phase-2 stopgap the file itself flags (lines 26–31).
- [ ] **Step 3:** Gate. **Step 4:** Commit `feat(next-web): derive admin-link visibility server-side (drop client permission fetch)`.

### Task J2: Logout via Server Action; drop react-query from the topbar
**Files:** Modify `src/components/layouts/layout-1/shared/topbar/user-dropdown-menu.tsx` (line 19 `useQueryClient`; 79 `clearAuth`; 97 client logout fetch).
- [ ] **Step 1:** Confirm/create the `logout` action (Task P1 Step 3): backend `POST /auth/logout` → delete `pf_at`/`pf_rt`/`pf_sel` → `redirect('/login')` (spec §4.3).
- [ ] **Step 2:** Replace the logout handler with `await logout()` inside a transition; delete `useQueryClient`/`qc.clear()` and `useStore(clearAuth)`. (The in-memory store is removed in Batch K — this must NOT depend on it.)
- [ ] **Step 3:** Gate. **Step 4:** Commit `feat(next-web): logout via Server Action (drop react-query/clearAuth from topbar)`.

### Task J3: Audit remaining layout token/query refs
**Files:** `src/components/layouts/layout-1/components/header.tsx` (showed `accessToken` in the grep) + any sibling.
- [ ] Trace why `header.tsx` reads `accessToken`. If it only forwards it to a now-converted child, remove it; otherwise convert that read with the G1 pattern. Gate + commit `refactor(next-web): drop in-memory token from layout header`.

> **Batch J gate:** `git grep -n "accessToken\|useQuery" -- apps/next-web/src/components/layouts` returns nothing; admin link correct for admin vs non-admin; logout clears cookies → `/login`.

---

## Batch K — Teardown + final verification

**Do not start until both burn-down greps are at target** (Task P1): react-query imports == only `providers.tsx`; client `accessToken`/`/api/v1` == only legitimate server/auth files.

### Task K1: Remove the AuthBootstrap gate
**Files:** Delete `src/app/(app)/auth-bootstrap.tsx`; Modify `src/app/(app)/layout.tsx` (remove `<AuthBootstrap>` wrapper + `ScreenLoader` gate).
- [ ] Confirm no other importer: `git grep -n "auth-bootstrap\|AuthBootstrap" -- apps/next-web/src` → only the layout. Delete + unwire. Gate (build) + commit `feat(next-web): remove AuthBootstrap gate`.

### Task K2: Remove the QueryClient provider + drop the dependency
**Files:** Modify `src/app/providers.tsx` (remove `QueryClientProvider`/`QueryClient`); Modify `apps/next-web/package.json` (remove `@tanstack/react-query`); lockfile.
- [ ] **Step 1:** Confirm zero remaining importers: `git grep -l "@tanstack/react-query" -- apps/next-web/src` → empty. If `providers.tsx` becomes a pure pass-through, simplify or remove it and update its consumer.
- [ ] **Step 2:** Remove the dep, reinstall to update the lockfile, build. Gate + commit `chore(next-web): remove @tanstack/react-query`.

### Task K3: Strip in-memory auth + selection bridge from the store
**Files:** Modify `src/store/useStore.ts` (remove `accessToken`/`setAuth`/`clearAuth` + the selection slice if unused); inspect `src/app/(app)/_components/selection-bridge.tsx` and the `pf_sel` flow.
- [ ] **Step 1:** `git grep -n "accessToken\|setAuth\|clearAuth" -- apps/next-web/src` → only the `useStore.ts` definitions remain (legit server cookie/auth-exchange files do NOT use the store). Remove the store fields.
- [ ] **Step 2:** Determine what the selection bridge still feeds. The `WorkspaceProjectSwitcher` (calls `setSelection` action + `router.refresh()`) must keep working. If the zustand selection slice is now dead, remove it; keep only roadmap viewport UI state (spec §3.1). If the switcher reads selection from server props now, delete the bridge too.
- [ ] **Step 3:** Gate (tsc/build) + commit `refactor(next-web): remove in-memory auth + dead selection state from store`.

### Task K4: Remove the client `/api/v1` rewrite if unused
**Files:** Modify `next.config.*` (the `rewrites()` for `/api/v1/:path*`).
- [ ] **Step 1:** Confirm zero client callers: `git grep -n "/api/v1" -- apps/next-web/src` returns only **server** files (`server/api.ts`, `server/actions/*`, `proxy.ts`, `app/api/auth/*`) — none in `'use client'` files. (If login/oauth pages still call auth endpoints directly, either keep the rewrite or route them through actions/route handlers — decide per finding.)
- [ ] **Step 2:** If unused by the client, remove the rewrite. Gate (build) + commit `chore(next-web): remove client /api/v1 rewrite`.

### Task K5: Delete dead client `api()` helpers
**Files:** any remaining client `api()`/`apiReq()`/`apiFetch()` helpers superseded by `serverFetch`.
- [ ] `git grep -n "function api\|const api =\|apiReq\|apiFetch" -- apps/next-web/src` — remove the now-unused client helpers (keep the server DAL). Gate + commit `chore(next-web): remove dead client api helpers`.

### Task K6: Final verification + Phase 3 verified marker
**Files:** none (verification); then `memory/csr-ssr-migration-state.md` + `MEMORY.md` update.
- [ ] **Step 1 — burn-down at zero:**
  ```bash
  git grep -l "@tanstack/react-query" -- apps/next-web/src              # expect: empty
  git grep -n "accessToken\|setAuth\|clearAuth" -- apps/next-web/src    # expect: none in client
  git grep -n "fetch('/api/v1\|fetch(\`/api/v1" -- apps/next-web/src    # expect: empty (client)
  ```
- [ ] **Step 2 — green:** tsc `--noEmit` exit 0; `vitest run` all pass; `build` exit 0.
- [ ] **Step 3 — interactive smoke (the non-negotiable Phase 2 lesson):** login → **no AuthBootstrap loader flash on reload**; board drag persists; open a card → comments/attachments/worklog/PRs work; project-settings integrations CRUD; admin roles + user-roles (admin acct); logout clears cookies → `/login`; workspace/project switch re-renders server data. Use the `e2e/_smoke` scripts as the harness.
- [ ] **Step 4 — marker:** `git commit --allow-empty -m "chore(ssr): Phase 3 teardown verified — react-query/in-memory token removed"`.
- [ ] **Step 5 — memory:** update `memory/csr-ssr-migration-state.md` (migration COMPLETE; what was removed) + the `MEMORY.md` index line.
- [ ] **Step 6 — finish the branch:** invoke superpowers:finishing-a-development-branch (merge/PR decision).

---

## Self-review notes (coverage against spec §3.6 / §7)

- spec §3.6 "remove AuthBootstrap + ScreenLoader" → **K1**. ✓
- spec §3.6 "remove react-query + providers.tsx QueryClient + every useQuery/useMutation" → conversions **G/H/I/J** drive the count to zero; **K2** removes provider + dep. ✓
- spec §3.6 "remove in-memory accessToken/setAuth/clearAuth; selection→cookie; roadmap viewport stays" → **K3**. ✓
- spec §3.6 "remove client /api/v1 rewrite if unused" → **K4**. ✓
- spec §3.6 "dead client api() helpers" → **K5**. ✓
- memory NEXT items "convert deferred self-fetching children … layout/sidebar RSC" → **G (drawer children), H (integrations), I (admin roles), J (layout/sidebar/topbar)**. ✓
- spec risk "file uploads need the token → route handler" → resolved instead via **Server Action + FormData** (Phase 2 avatar precedent), **G4**. Documented deviation. ✓
- Gates: every batch ends green + reviewed + smoke-tested; Batch K gated on the objective burn-down greps. ✓

**Open items the implementer must confirm at execution time (flagged, not placeholders):** exact `ActionResult` discriminant in `result.ts`; each list endpoint's envelope vs raw body (`serverFetch`/`serverFetchEnvelope`/`serverFetchBody`); whether the `logout` action already exists; the `PermissionPicker` permissions endpoint path; what the selection bridge still feeds before K3 deletes it.
