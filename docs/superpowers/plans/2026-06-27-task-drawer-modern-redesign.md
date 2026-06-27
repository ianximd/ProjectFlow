# Task Drawer Modern Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the task detail drawer as a modern two-column, tabbed module (Details / Comments / Files / Activity + a properties sidebar), ~960px wide with expand-to-full, fully themed with Ocean Blue tokens — keeping every existing feature and all existing data/mutation logic.

**Architecture:** `TaskDrawer.tsx` stays the orchestrator (all data loading, optimistic mutations, presence, subscriptions preserved). It gains a layout shell: full-width header, full-width title, then a two-column body — a tabbed main column (tab panels are in-file render functions) and a properties sidebar. Existing sub-components are reused unchanged, relocated into slots. One new component, `ActivityTab`, is backed by a new dedicated `taskActivity` GraphQL query that reuses the existing audit repository.

**Tech Stack:** Next.js (custom fork — read `node_modules/next/dist/docs/` before writing Next code), React 19 + `useTransition`, CSS Modules + Ocean Blue CSS custom properties, Pothos GraphQL (`builder`), `next-intl`, MSSQL stored procedures, Vitest + Testing Library.

## Global Constraints

- **Theme tokens only:** no hardcoded hex in the drawer surface. Use `var(--background)`, `var(--foreground)`, `var(--border)`, `var(--secondary)`, `var(--secondary-foreground)`, `var(--muted-foreground)`, `var(--accent)`, `var(--ring)`. Light + dark must both be correct.
- **No new task-mutation APIs.** Only the additive `taskActivity` read query is new.
- **Preserve existing behavior:** optimistic updates with rollback + `notifyActionError` toasts, presence, Apollo comment subscription, the `time_tracking` app gate (hide time tracking when OFF), and all keyboard affordances (Escape/Enter on title, Cmd/Ctrl+Enter on description).
- **i18n:** all user-facing strings go through `next-intl`. The drawer uses `useTranslations('Task')`. Add new keys to BOTH `apps/next-web/messages/en.json` and `apps/next-web/messages/id.json`.
- **Next.js fork:** before writing any Next-specific code, read the relevant guide in `apps/next-web/node_modules/next/dist/docs/`.
- **Story points stay a read-only badge** (editing out of scope).
- **Activity v1 caveat:** task *create* event won't appear (audit CREATE rows store null `resourceId`); all edits do.

---

## File Structure

**Backend (new/modified):**
- Modify: `apps/api/src/modules/activity/activity.service.ts` — add `getTaskActivity()`.
- Modify: `apps/api/src/graphql/activity.schema.ts` — register `taskActivity` query.
- Modify: `apps/api/src/modules/activity/__tests__/activity.integration.test.ts` — cover `taskActivity`.

**Frontend (new/modified):**
- Modify: `apps/next-web/src/server/queries/activity.ts` — add `getTaskActivity()` SSR helper.
- Create: `apps/next-web/src/server/actions/activity.ts` — `loadTaskActivity()` client-callable wrapper.
- Create: `apps/next-web/src/components/task-drawer/auditDiff.ts` — pure audit-entry formatter.
- Create: `apps/next-web/src/components/task-drawer/auditDiff.test.ts` — formatter unit tests.
- Create: `apps/next-web/src/components/task-drawer/ActivityTab.tsx` — Activity tab UI.
- Create: `apps/next-web/src/components/task-drawer/ActivityTab.module.css` — Activity tab styles (tokens).
- Modify: `apps/next-web/src/components/CommentSection.module.css` — token migration.
- Modify: `apps/next-web/src/components/AttachmentSection.module.css` — token migration.
- Modify: `apps/next-web/src/components/WorkLogSection.module.css` — token migration.
- Modify: `apps/next-web/src/components/pull-requests.module.css` — token migration.
- Modify: `apps/next-web/src/components/TaskDrawer.module.css` — layout classes (grid/sidebar/main/tabs/expand/responsive).
- Modify: `apps/next-web/src/components/TaskDrawer.tsx` — restructure into header + two-column + tabs; relocate sections; inline-hex → tokens; mount tabs.
- Modify: `apps/next-web/messages/en.json` + `id.json` — new `Task.tabs.*` + `Activity.*` strings.

---

## Task 1: Backend — `taskActivity` GraphQL query

**Files:**
- Modify: `apps/api/src/modules/activity/activity.service.ts`
- Modify: `apps/api/src/graphql/activity.schema.ts`
- Test: `apps/api/src/modules/activity/__tests__/activity.integration.test.ts`

**Interfaces:**
- Consumes: `taskRepository.getById(taskId)` → `Task | null` (has `Id`, `ListId`, `WorkspaceId`); `accessService.can(userId, 'LIST', listId, 'VIEW') → Promise<boolean>`; `activityRepository.listScoped(filters: AuditFilters) → Promise<AuditLogPage>`.
- Produces: `activityService.getTaskActivity(userId: string, taskId: string, opts: { page?: number; pageSize?: number }) → Promise<AuditLogPage>`; GraphQL `taskActivity(taskId: String!, page: Int, pageSize: Int): AuditLogPage!`.

- [ ] **Step 1: Write the failing integration test**

In `activity.integration.test.ts`, add (follow the file's existing harness/fixtures for seeding a task + audit rows and building a GQL context):

```typescript
describe('taskActivity', () => {
  it('returns audit rows for the task and enforces LIST VIEW authz', async () => {
    // Arrange: seed a task in a list the member can VIEW, and write an
    // audit UPDATE row with resource='Task', resourceId=task.id.
    const { task, memberCtx, outsiderCtx } = await seedTaskWithAudit();

    // Act + Assert: member sees the row
    const page = await activityService.getTaskActivity(
      memberCtx.user.userId, task.id, { page: 1, pageSize: 50 },
    );
    expect(page.entries.some(e => e.resourceId === task.id)).toBe(true);

    // Assert: a caller without LIST VIEW is forbidden
    await expect(
      activityService.getTaskActivity(outsiderCtx.user.userId, task.id, {}),
    ).rejects.toThrow(/forbidden/i);
  });

  it('throws NOT_FOUND for a missing task', async () => {
    await expect(
      activityService.getTaskActivity('00000000-0000-0000-0000-000000000000',
        '11111111-1111-1111-1111-111111111111', {}),
    ).rejects.toThrow(/not found/i);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd apps/api && npx vitest run src/modules/activity/__tests__/activity.integration.test.ts -t taskActivity`
Expected: FAIL — `activityService.getTaskActivity is not a function`.

- [ ] **Step 3: Implement the service method**

In `activity.service.ts`, add imports and the method on `ActivityService`:

```typescript
import { taskRepository } from '../tasks/task.repository.js';
// (accessService + activityRepository are already imported)

  /**
   * Activity feed for a single task. Visibility derives from the containing
   * LIST (same rule as HIERARCHY_RESOURCE). Reuses listScoped with a
   * resourceId=taskId filter — task UPDATE audit rows carry resourceId=taskId.
   */
  async getTaskActivity(
    userId:   string,
    taskId:   string,
    opts:     { page?: number; pageSize?: number } = {},
  ): Promise<AuditLogPage> {
    const task = await taskRepository.getById(taskId);
    if (!task) {
      throw new GraphQLError('Task not found', { extensions: { code: 'NOT_FOUND' } });
    }
    const listId = (task as { ListId?: string; listId?: string }).ListId
                 ?? (task as { listId?: string }).listId;
    const workspaceId = (task as { WorkspaceId?: string; workspaceId?: string }).WorkspaceId
                 ?? (task as { workspaceId?: string }).workspaceId;
    if (!listId || !workspaceId) {
      throw new GraphQLError('Task not found', { extensions: { code: 'NOT_FOUND' } });
    }
    const allowed = await accessService.can(userId, 'LIST', listId, 'VIEW');
    if (!allowed) {
      throw new GraphQLError('Forbidden', { extensions: { code: 'FORBIDDEN' } });
    }
    return activityRepository.listScoped({
      workspaceId,
      resourceId: taskId,
      page:       opts.page && opts.page >= 1 ? opts.page : 1,
      pageSize:   opts.pageSize && opts.pageSize >= 1 ? Math.min(opts.pageSize, 200) : 50,
    });
  }
```

- [ ] **Step 4: Register the GraphQL query**

In `activity.schema.ts`, inside `registerActivityGraphql()`'s `builder.queryFields`, add a second field next to `activityFeed`:

```typescript
    taskActivity: t.field({
      type:     AuditLogPageType,
      nullable: false,
      args: {
        taskId:   t.arg.string({ required: true }),
        page:     t.arg.int({ required: false }),
        pageSize: t.arg.int({ required: false }),
      },
      resolve: async (_root, args, ctx) => {
        requireUser(ctx);
        return activityService.getTaskActivity(ctx.user.userId, args.taskId, {
          page:     args.page     ?? undefined,
          pageSize: args.pageSize ?? undefined,
        });
      },
    }),
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `cd apps/api && npx vitest run src/modules/activity/__tests__/activity.integration.test.ts -t taskActivity`
Expected: PASS (both cases).

- [ ] **Step 6: Typecheck**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/activity/activity.service.ts apps/api/src/graphql/activity.schema.ts apps/api/src/modules/activity/__tests__/activity.integration.test.ts
git commit -m "feat(api): taskActivity query for task-scoped audit feed"
```

---

## Task 2: Frontend SSR helper — `getTaskActivity`

**Files:**
- Modify: `apps/next-web/src/server/queries/activity.ts`

**Interfaces:**
- Consumes: `gqlData<T>(query, vars)` (already imported from `./views`); the `taskActivity` query from Task 1; `parseEntry` (already defined in this file).
- Produces: `getTaskActivity(taskId: string, page?: number, pageSize?: number) → Promise<AuditLogPage | null>`.

- [ ] **Step 1: Add the query + exported helper**

Append to `apps/next-web/src/server/queries/activity.ts` (reuse the existing `parseEntry` reviver):

```typescript
const TASK_ACTIVITY_QUERY = /* GraphQL */ `
  query TaskActivity($taskId: String!, $page: Int, $pageSize: Int) {
    taskActivity(taskId: $taskId, page: $page, pageSize: $pageSize) {
      total
      page
      pageSize
      entries {
        id workspaceId userId userEmail action resource resourceId
        oldValues newValues ipAddress createdAt
      }
    }
  }
`;

/** SSR-fetch the audit feed for a single task. Null on error so the
 *  Activity tab can fall back to an empty feed. */
export const getTaskActivity = cache(async (
  taskId: string,
  page = 1,
  pageSize = 50,
): Promise<import('@projectflow/types').AuditLogPage | null> => {
  try {
    const { taskActivity } = await gqlData<{
      taskActivity: {
        total: number; page: number; pageSize: number;
        entries: Record<string, unknown>[];
      } | null;
    }>(TASK_ACTIVITY_QUERY, { taskId, page, pageSize });

    if (!taskActivity) return { entries: [], total: 0, page, pageSize };
    return {
      total:    taskActivity.total,
      page:     taskActivity.page,
      pageSize: taskActivity.pageSize,
      entries:  (taskActivity.entries ?? []).map(parseEntry),
    };
  } catch {
    return null;
  }
});
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/next-web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/next-web/src/server/queries/activity.ts
git commit -m "feat(web): getTaskActivity SSR query helper"
```

---

## Task 3: Audit diff formatter (pure, unit-tested)

**Files:**
- Create: `apps/next-web/src/components/task-drawer/auditDiff.ts`
- Test: `apps/next-web/src/components/task-drawer/auditDiff.test.ts`

**Interfaces:**
- Consumes: `AuditLogEntry` from `@projectflow/types` (`action`, `resource`, `oldValues`, `newValues`, `userEmail`, `createdAt`).
- Produces: `formatAuditEntry(entry: AuditLogEntry): { summary: string; changes: { field: string; from: string; to: string }[] }` and `groupByDay(entries: AuditLogEntry[]): { day: string; entries: AuditLogEntry[] }[]`.

- [ ] **Step 1: Write the failing tests**

Create `auditDiff.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatAuditEntry, groupByDay } from './auditDiff';
import type { AuditLogEntry } from '@projectflow/types';

const base: AuditLogEntry = {
  id: '1', workspaceId: 'w', userId: 'u', userEmail: 'amy@x.io',
  action: 'UPDATE', resource: 'Task', resourceId: 't1',
  oldValues: null, newValues: null, ipAddress: null, userAgent: null,
  createdAt: '2026-06-27T10:00:00.000Z',
};

describe('formatAuditEntry', () => {
  it('renders known field changes as from -> to', () => {
    const r = formatAuditEntry({ ...base,
      oldValues: { status: 'TODO', priority: 'LOW' },
      newValues: { status: 'IN_PROGRESS', priority: 'HIGH' } });
    expect(r.changes).toContainEqual({ field: 'status', from: 'TODO', to: 'IN_PROGRESS' });
    expect(r.changes).toContainEqual({ field: 'priority', from: 'LOW', to: 'HIGH' });
  });

  it('falls back to JSON for unknown/object values', () => {
    const r = formatAuditEntry({ ...base,
      oldValues: { meta: { a: 1 } }, newValues: { meta: { a: 2 } } });
    expect(r.changes[0].from).toContain('a');
    expect(r.changes[0].to).toContain('2');
  });

  it('summarizes CREATE without a diff', () => {
    const r = formatAuditEntry({ ...base, action: 'CREATE' });
    expect(r.summary.toLowerCase()).toContain('created');
    expect(r.changes).toEqual([]);
  });
});

describe('groupByDay', () => {
  it('buckets entries by calendar day, newest first', () => {
    const e1 = { ...base, id: 'a', createdAt: '2026-06-27T10:00:00.000Z' };
    const e2 = { ...base, id: 'b', createdAt: '2026-06-26T09:00:00.000Z' };
    const groups = groupByDay([e2, e1]);
    expect(groups[0].entries[0].id).toBe('a');
    expect(groups).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `cd apps/next-web && npx vitest run src/components/task-drawer/auditDiff.test.ts`
Expected: FAIL — cannot find module `./auditDiff`.

- [ ] **Step 3: Implement the formatter**

Create `auditDiff.ts`:

```typescript
import type { AuditLogEntry } from '@projectflow/types';

/** Fields we render with friendly labels; anything else falls back to raw JSON. */
const KNOWN_FIELDS = new Set([
  'status', 'priority', 'title', 'description', 'startDate', 'dueDate',
  'storyPoints', 'assignees', 'type', 'name',
]);

function show(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

export interface AuditChange { field: string; from: string; to: string; }
export interface FormattedEntry { summary: string; changes: AuditChange[]; }

export function formatAuditEntry(entry: AuditLogEntry): FormattedEntry {
  const who = entry.userEmail ?? 'Someone';
  if (entry.action === 'CREATE') return { summary: `${who} created this task`, changes: [] };
  if (entry.action === 'DELETE') return { summary: `${who} deleted this task`, changes: [] };

  const oldV = entry.oldValues ?? {};
  const newV = entry.newValues ?? {};
  const keys = Array.from(new Set([...Object.keys(oldV), ...Object.keys(newV)]));
  const changes: AuditChange[] = keys
    .filter((k) => KNOWN_FIELDS.has(k) || k in oldV || k in newV)
    .map((field) => ({ field, from: show(oldV[field]), to: show(newV[field]) }))
    .filter((c) => c.from !== c.to);

  return { summary: `${who} updated this task`, changes };
}

export function groupByDay(entries: AuditLogEntry[]): { day: string; entries: AuditLogEntry[] }[] {
  const sorted = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const map = new Map<string, AuditLogEntry[]>();
  for (const e of sorted) {
    const day = e.createdAt.slice(0, 10); // YYYY-MM-DD
    const bucket = map.get(day) ?? [];
    if (!map.has(day)) map.set(day, bucket);
    bucket.push(e);
  }
  return Array.from(map.entries()).map(([day, es]) => ({ day, entries: es }));
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `cd apps/next-web && npx vitest run src/components/task-drawer/auditDiff.test.ts`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add apps/next-web/src/components/task-drawer/auditDiff.ts apps/next-web/src/components/task-drawer/auditDiff.test.ts
git commit -m "feat(web): bounded audit-entry diff formatter for activity tab"
```

---

## Task 4: `ActivityTab` component

**Files:**
- Create: `apps/next-web/src/server/actions/activity.ts`
- Create: `apps/next-web/src/components/task-drawer/ActivityTab.tsx`
- Create: `apps/next-web/src/components/task-drawer/ActivityTab.module.css`
- Modify: `apps/next-web/messages/en.json`, `apps/next-web/messages/id.json` (Activity strings)

**Interfaces:**
- Consumes: `getTaskActivity` (Task 2), `formatAuditEntry` + `groupByDay` (Task 3), `useTranslations('Activity')`.
- Produces: `loadTaskActivity(taskId: string) → Promise<AuditLogPage | null>` (server action); `export function ActivityTab({ taskId }: { taskId: string }): JSX.Element`.

- [ ] **Step 1: Add i18n strings**

In `en.json`, under the existing top-level `"Activity"` object add (merge, don't replace existing keys):

```json
"tabEmpty": "No activity yet",
"tabLoading": "Loading activity…",
"tabError": "Couldn't load activity"
```

In `id.json`, under `"Activity"`:

```json
"tabEmpty": "Belum ada aktivitas",
"tabLoading": "Memuat aktivitas…",
"tabError": "Gagal memuat aktivitas"
```

- [ ] **Step 2: Create the server action wrapper**

`getTaskActivity` is a `server-only` query and cannot be imported into a client component. Wrap it. Create `apps/next-web/src/server/actions/activity.ts`:

```typescript
'use server';
import { getTaskActivity } from '@/server/queries/activity';
import type { AuditLogPage } from '@projectflow/types';

export async function loadTaskActivity(taskId: string): Promise<AuditLogPage | null> {
  return getTaskActivity(taskId, 1, 50);
}
```

- [ ] **Step 3: Implement the component**

Create `ActivityTab.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AuditLogPage } from '@projectflow/types';
import { loadTaskActivity } from '@/server/actions/activity';
import { formatAuditEntry, groupByDay } from './auditDiff';
import styles from './ActivityTab.module.css';

export function ActivityTab({ taskId }: { taskId: string }) {
  const t = useTranslations('Activity');
  const [page, setPage] = useState<AuditLogPage | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    setState('loading');
    loadTaskActivity(taskId)
      .then((p) => { if (!active) return; if (p) { setPage(p); setState('ready'); } else setState('error'); })
      .catch(() => { if (active) setState('error'); });
    return () => { active = false; };
  }, [taskId]);

  if (state === 'loading') return <p className={styles.muted}>{t('tabLoading')}</p>;
  if (state === 'error')   return <p className={styles.muted}>{t('tabError')}</p>;
  if (!page || page.entries.length === 0) return <p className={styles.muted}>{t('tabEmpty')}</p>;

  return (
    <div className={styles.feed}>
      {groupByDay(page.entries).map(({ day, entries }) => (
        <section key={day} className={styles.dayGroup}>
          <h4 className={styles.dayLabel}>{day}</h4>
          {entries.map((e) => {
            const f = formatAuditEntry(e);
            return (
              <div key={e.id} className={styles.entry}>
                <div className={styles.summary}>{f.summary}</div>
                {f.changes.map((c) => (
                  <div key={c.field} className={styles.change}>
                    <span className={styles.field}>{c.field}</span>
                    <span className={styles.from}>{c.from}</span>
                    <span className={styles.arrow}>→</span>
                    <span className={styles.to}>{c.to}</span>
                  </div>
                ))}
                <time className={styles.time}>{new Date(e.createdAt).toLocaleTimeString()}</time>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
```

Create `ActivityTab.module.css` (tokens only):

```css
.feed { display: flex; flex-direction: column; gap: 20px; }
.muted { font-size: 14px; color: var(--muted-foreground); }
.dayGroup { display: flex; flex-direction: column; gap: 10px; }
.dayLabel { font-size: 12px; font-weight: 600; color: var(--muted-foreground);
  text-transform: uppercase; letter-spacing: 0.6px; margin: 0; }
.entry { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px;
  border: 1px solid var(--border); border-radius: 8px; background: var(--secondary); }
.summary { font-size: 13px; color: var(--foreground); }
.change { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted-foreground); }
.field { font-weight: 600; color: var(--secondary-foreground); }
.from { text-decoration: line-through; }
.arrow { color: var(--muted-foreground); }
.to { color: var(--foreground); }
.time { font-size: 11px; color: var(--muted-foreground); }
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/next-web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/next-web/src/components/task-drawer/ActivityTab.tsx apps/next-web/src/components/task-drawer/ActivityTab.module.css apps/next-web/src/server/actions/activity.ts apps/next-web/messages/en.json apps/next-web/messages/id.json
git commit -m "feat(web): ActivityTab component for task drawer"
```

---

## Task 5: Theme-token migration — sub-section CSS modules

**Files:**
- Modify: `apps/next-web/src/components/CommentSection.module.css`
- Modify: `apps/next-web/src/components/AttachmentSection.module.css`
- Modify: `apps/next-web/src/components/WorkLogSection.module.css`
- Modify: `apps/next-web/src/components/pull-requests.module.css`

**Token mapping** (apply to every hardcoded hex; pick the closest semantic token):

| Old (dark) hex | Token |
|---|---|
| page/panel background `#1a202c`, `#1c2333`, `#0f172a` | `var(--background)` |
| raised surface `#2d3748`, `#2a3441` | `var(--secondary)` |
| primary text `#e2e8f0`, `#f7fafc`, `#fff` (on dark) | `var(--foreground)` |
| muted/secondary text `#a0aec0`, `#718096`, `#94a3b8` | `var(--muted-foreground)` |
| borders/dividers `#4a5568`, `#374151`, `#2d3748` (as border) | `var(--border)` |
| hover/active fill | `var(--accent)` |
| focus ring | `var(--ring)` |
| accent/link/primary action blues | `var(--accent)` (or existing accent token if a distinct one exists) |

- [ ] **Step 1: Inventory the hex values**

Run: `cd apps/next-web && grep -nEi "#[0-9a-f]{3,8}\b" src/components/CommentSection.module.css src/components/AttachmentSection.module.css src/components/WorkLogSection.module.css src/components/pull-requests.module.css`
Expected: a list of every hardcoded color to replace. (Note any rgba() shadows/overlays too — keep neutral shadows as low-alpha rgba; do not tokenize pure shadows.)

- [ ] **Step 2: Replace per the mapping**

Edit each file, swapping each hex for its mapped token. Leave layout/spacing untouched. For semi-transparent overlays/shadows, keep an `rgba(...)` but neutral (e.g. `rgba(2, 6, 23, 0.28)` for shadows, matching `TaskDrawer.module.css`).

- [ ] **Step 3: Verify no hex remains**

Run: `cd apps/next-web && grep -nEi "#[0-9a-f]{3,8}\b" src/components/CommentSection.module.css src/components/AttachmentSection.module.css src/components/WorkLogSection.module.css src/components/pull-requests.module.css`
Expected: NO matches (empty output). rgba() shadow lines are acceptable and won't match this hex pattern.

- [ ] **Step 4: Visual check (manual)**

Run the app (`/run` or the project's dev command), open a task drawer, toggle light/dark theme. Confirm comments, attachments, worklog, and PR sections read correctly in both themes.

- [ ] **Step 5: Commit**

```bash
git add apps/next-web/src/components/CommentSection.module.css apps/next-web/src/components/AttachmentSection.module.css apps/next-web/src/components/WorkLogSection.module.css apps/next-web/src/components/pull-requests.module.css
git commit -m "style(web): migrate task drawer sub-sections to theme tokens"
```

---

## Task 6: Layout CSS — header, two-column grid, sidebar, tabs, expand, responsive

**Files:**
- Modify: `apps/next-web/src/components/TaskDrawer.module.css`

**Interfaces:**
- Produces (class names consumed by Task 7): `.drawer--expanded`, `.titleBlock`, `.bodyGrid`, `.mainCol`, `.sidebar`, `.tabBar`, `.tab`, `.tab--active`, `.tabPanel`, `.propRow`, `.propLabel`, `.propValue`, `.expandBtn`.

- [ ] **Step 1: Widen the drawer + add expand modifier**

In `TaskDrawer.module.css`, change `.drawer` width and add an expanded modifier + reduced-motion guard:

```css
.drawer {
  /* width: 720px; -> */
  width: 960px;
  max-width: 96vw;
  transition: width 0.28s cubic-bezier(0.32, 0.72, 0, 1);
}
.drawer--expanded { width: 96vw; }

@media (prefers-reduced-motion: reduce) {
  .drawer { animation: none; transition: none; }
}
```

- [ ] **Step 2: Add the title block + two-column grid**

Keep `.body` for the overall flex column; add the grid + title block. Append:

```css
.titleBlock {
  padding: 16px 24px 0 24px;
  flex-shrink: 0;
}
.bodyGrid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 0;
  overflow: hidden;
}
.mainCol {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  border-right: 1px solid var(--border);
}
.sidebar {
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: var(--background);
}
```

- [ ] **Step 3: Add tab bar + panel styles**

```css
.tabBar {
  display: flex;
  gap: 4px;
  padding: 0 24px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.tab {
  appearance: none;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 12px 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted-foreground);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.tab:hover { color: var(--foreground); }
.tab:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.tab--active { color: var(--foreground); border-bottom-color: var(--accent); }
.tabPanel {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}
```

- [ ] **Step 4: Add property-row + expand-button styles**

```css
.propRow {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.propLabel {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted-foreground);
  text-transform: uppercase;
  letter-spacing: 0.6px;
}
.propValue { font-size: 14px; color: var(--foreground); }
.expandBtn { /* same visual language as .closeBtn */
  background: none; border: none; color: var(--muted-foreground); cursor: pointer;
  padding: 6px; border-radius: 8px; display: flex; align-items: center;
  transition: color 0.15s, background-color 0.15s;
}
.expandBtn:hover { color: var(--foreground); background: var(--accent); }
.expandBtn:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
```

- [ ] **Step 5: Add responsive collapse**

```css
@media (max-width: 900px) {
  .bodyGrid { grid-template-columns: 1fr; overflow-y: auto; }
  .mainCol { border-right: none; border-bottom: 1px solid var(--border); }
  .sidebar { order: 2; }
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/next-web/src/components/TaskDrawer.module.css
git commit -m "style(web): layout classes for two-column tabbed task drawer"
```

---

## Task 7: `TaskDrawer.tsx` restructure — header, two-column, tabs, relocation, token cleanup

**Files:**
- Modify: `apps/next-web/src/components/TaskDrawer.tsx`
- Modify: `apps/next-web/messages/en.json`, `apps/next-web/messages/id.json` (tab labels)

**Interfaces:**
- Consumes: all classes from Task 6; `ActivityTab` (Task 4); existing sub-components and state already in the file.
- Produces: the restructured drawer (no new exports).

> This task relocates existing JSX — it does NOT rewrite the working logic (state, effects, mutations). Keep every existing handler and state variable. Move the rendered blocks into the new structure and replace inline hardcoded hex with tokens as you touch each block.

- [ ] **Step 1: Add tab labels to i18n**

In `en.json` under `"Task"`, add a `"tabs"` object:

```json
"tabs": { "details": "Details", "comments": "Comments", "files": "Files", "activity": "Activity" }
```

In `id.json` under `"Task"`:

```json
"tabs": { "details": "Detail", "comments": "Komentar", "files": "Berkas", "activity": "Aktivitas" }
```

- [ ] **Step 2: Add tab + expand state and import ActivityTab**

Near the other `useState` calls in `TaskDrawer`, add:

```tsx
type DrawerTab = 'details' | 'comments' | 'files' | 'activity';
const [activeTab, setActiveTab] = useState<DrawerTab>('details');
const [expanded, setExpanded] = useState(false);
```

Import at the top:

```tsx
import { ActivityTab } from './task-drawer/ActivityTab';
```

- [ ] **Step 3: Extract the current body into render functions**

Within the component, define render functions that RETURN the existing JSX blocks (cut from the current single `.body`, do not rewrite):

```tsx
const renderDetailsTab = () => (<> {/* description, dependencies, recurrence, custom fields, PRs, WorkLogSection */} </>);
const renderSidebar    = () => (<> {/* status, priority, type+milestone, story-points badge, assignees, schedule, tags, watchers, time summary (TaskEstimateBar + timer + Log time) */} </>);
```

Rules while moving blocks:
- Description, `DependenciesSection`, `RecurrenceEditor`, custom fields, `PullRequestsSection`, and the full `WorkLogSection` → `renderDetailsTab`.
- Status, priority, `TaskTypeSelector` (+ milestone marker), story-points badge (read-only), assignees chips+picker, schedule (start/due + clear), `TagPicker`, `WatcherControl`, and the time summary (`TaskEstimateBar` + timer + "Log time") → `renderSidebar`.
- The `time_tracking` app-gate condition (`isAppOn(...)`) must still wrap BOTH the sidebar time summary AND the Details-tab `WorkLogSection`.
- `CommentSection` and `AttachmentSection` are mounted directly in their tabs (Step 4), not in these functions.
- Replace any inline `style={{ color: '#...', background: '#...', border: '...#...' }}` you encounter in moved blocks with the `styles.propRow`/`propLabel`/`propValue` classes or inline `var(--token)` values.

- [ ] **Step 4: Rebuild the drawer JSX shell**

Replace the drawer container + header + body with:

```tsx
<div
  className={`${styles.drawer}${expanded ? ' ' + styles['drawer--expanded'] : ''}`}
  role="dialog" aria-modal="true"
>
  <div className={styles.header}>
    {/* LEFT: breadcrumb + issueKey + recurrence badge (keep existing) */}
    {/* CENTER/RIGHT: PresenceBar (keep existing) */}
    <div /* actions */>
      {/* keep existing Share + SaveAsTemplate buttons */}
      <button
        type="button"
        className={styles.expandBtn}
        aria-label={expanded ? 'Collapse' : 'Expand'}
        aria-pressed={expanded}
        onClick={() => setExpanded((v) => !v)}
      >{/* ⤢ icon */}</button>
      {/* keep existing close button */}
    </div>
  </div>

  <div className={styles.titleBlock}>
    {/* keep the existing click-to-edit title block */}
  </div>

  <div className={styles.bodyGrid}>
    <div className={styles.mainCol}>
      <div className={styles.tabBar} role="tablist" aria-label="Task sections">
        {(['details','comments','files','activity'] as const).map((tab) => (
          <button
            key={tab}
            role="tab"
            id={`task-tab-${tab}`}
            aria-selected={activeTab === tab}
            aria-controls={`task-panel-${tab}`}
            tabIndex={activeTab === tab ? 0 : -1}
            className={`${styles.tab}${activeTab === tab ? ' ' + styles['tab--active'] : ''}`}
            onClick={() => setActiveTab(tab)}
            onKeyDown={(e) => {
              const order = ['details','comments','files','activity'] as const;
              const i = order.indexOf(activeTab);
              if (e.key === 'ArrowRight') setActiveTab(order[(i + 1) % order.length]);
              if (e.key === 'ArrowLeft')  setActiveTab(order[(i + order.length - 1) % order.length]);
            }}
          >{t(`tabs.${tab}`)}</button>
        ))}
      </div>

      <div
        className={styles.tabPanel}
        role="tabpanel"
        id={`task-panel-${activeTab}`}
        aria-labelledby={`task-tab-${activeTab}`}
      >
        {activeTab === 'details'  && renderDetailsTab()}
        {activeTab === 'comments' && <CommentSection /* keep existing props */ />}
        {activeTab === 'files'    && <AttachmentSection /* keep existing props */ />}
        {activeTab === 'activity' && taskId && <ActivityTab taskId={taskId} />}
      </div>
    </div>

    <aside className={styles.sidebar}>{renderSidebar()}</aside>
  </div>
</div>
```

(Use whatever local variable currently holds the task id for `taskId`; the file already derives it from `task.id ?? task.Id`.)

- [ ] **Step 5: Remove now-dead inline styles + scan for stragglers**

Run: `cd apps/next-web && grep -nEi "#[0-9a-f]{3,8}\b" src/components/TaskDrawer.tsx`
Replace each remaining hardcoded hex with the appropriate `var(--token)` (mapping table from Task 5). Re-run until empty (rgba shadow lines are acceptable).

- [ ] **Step 6: Typecheck**

Run: `cd apps/next-web && npx tsc --noEmit`
Expected: no errors. Fix any prop/name mismatches introduced by relocation.

- [ ] **Step 7: Manual smoke test**

Run the app, open a task drawer. Verify: all four tabs switch; sidebar shows every property; expand toggles to near-full-screen and back; time tracking hidden when the app is OFF; light + dark both correct; description/title/status/priority/assignee edits still save (optimistic + persisted).

- [ ] **Step 8: Commit**

```bash
git add apps/next-web/src/components/TaskDrawer.tsx apps/next-web/messages/en.json apps/next-web/messages/id.json
git commit -m "feat(web): two-column tabbed task drawer with expand"
```

---

## Task 8: Accessibility + verification pass

**Files:**
- Modify: `apps/next-web/src/components/TaskDrawer.tsx` (focus management only, if needed)
- Test: `apps/next-web/src/components/task-drawer/__tests__/TaskDrawer.tabs.test.tsx` (Create, lightweight)

**Interfaces:**
- Consumes: the restructured drawer.
- Produces: a tab-switching render test; verified a11y behaviors.

- [ ] **Step 1: Write a lightweight tab-switching test**

Create `TaskDrawer.tabs.test.tsx`. Mock the heavy children (`CommentSection`, `AttachmentSection`, `ActivityTab`, and server actions) so the test only exercises tab state. Follow the repo's existing component-test setup (next-intl provider wrapper). Assert:

```tsx
// Render the drawer with a minimal task.
// Default: Details panel visible.
// Click the Comments tab → role="tabpanel" labelled by the Comments tab,
//   and the mocked CommentSection is shown.
// ArrowRight from Comments → Files panel shown.
expect(screen.getByRole('tab', { name: /comments/i })).toHaveAttribute('aria-selected', 'true');
```

- [ ] **Step 2: Run the test**

Run: `cd apps/next-web && npx vitest run src/components/task-drawer/__tests__/TaskDrawer.tabs.test.tsx`
Expected: PASS. (If the drawer is hard to render in isolation, scope the test to a small extracted tab-bar render, or skip with a documented reason — do not block on deep mocking.)

- [ ] **Step 3: Manual a11y checklist**

Verify and fix if needed:
- Focus moves into the drawer on open; Escape closes and returns focus to the trigger (existing behavior retained).
- `role=tablist/tab/tabpanel` wired (Task 7); ArrowLeft/Right cycle tabs; only the active tab is in the tab order (`tabIndex`).
- All interactive controls (selects, pickers, buttons, expand) show a visible `--ring` focus outline.
- `aria-modal="true"` present; expand button exposes `aria-pressed`.

- [ ] **Step 4: Full verification**

Run: `cd apps/next-web && npx tsc --noEmit && npx vitest run src/components/task-drawer` then `cd apps/api && npx vitest run src/modules/activity`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/next-web/src/components/task-drawer/__tests__/TaskDrawer.tabs.test.tsx apps/next-web/src/components/TaskDrawer.tsx
git commit -m "test(web): task drawer tab switching + a11y pass"
```

---

## Self-Review Notes (author)

- **Spec coverage:** §3 approach → Tasks 6–7; §3a backend → Tasks 1–2; §4 layout/placement → Tasks 6–7; §5 theming → Tasks 5 + 7 Step 5; §6 states (expand/responsive/loading/app-gate/a11y/activity caveat) → Tasks 6, 7, 8 + Task 4 (loading/empty/error); §7 testing → Tasks 1, 3, 8.
- **Type consistency:** `getTaskActivity` (query) → wrapped by `loadTaskActivity` (action) → GraphQL `taskActivity` → service `getTaskActivity`. Names are intentional per layer. `formatAuditEntry`/`groupByDay` names match between Task 3 and Task 4. `AuditLogPage`/`AuditLogEntry` from `@projectflow/types` used consistently.
- **Known soft spots for the implementer:** moving JSX in Task 7 is the riskiest step — keep handlers intact and lean on `tsc` to catch mismatches; the Task 8 isolated render test may need the repo's existing test harness for next-intl + Apollo providers.
