# Phase 9e — Activity, Embed & Doc Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the three "lens" view types `activity`, `embed`, and `doc` to the Views Engine. Activity is a reverse-chronological, hierarchy-scoped, object-level-filtered, paginated feed over the existing `dbo.AuditLog` (via `usp_AuditLog_List`) with **live prepend** off the realtime event stream and filter-by-actor/action. Embed renders a sandboxed `<iframe>` for an external URL stored in `SavedViews.config`, validated/normalized through a pure URL guard (allow-list `http`/`https`, reject `javascript:`/`data:`/etc.). Doc resolves a pinned Phase 7 doc id from `config` and embeds the Phase 7 doc reader — **but Phase 7 docs are not present in the repo today**, so Doc ships as a **feature-flagged stub** (per the spec's deferral 4) wired so it lights up unchanged when Phase 7 lands.

**Architecture:** No new source of truth. Each new type is a **client renderer registered in `view-surface.tsx`** plus, for Activity, a backend resolver. Activity reads `usp_AuditLog_List` through a new `activity.service`/`activity.repository` pair, scoped to the view's hierarchy node (its `Resource`/`ResourceId` set, narrowed by the requesting user's object-level filter) and paginated; the existing `AuditLogEntry`/`AuditLogPage` types are reused verbatim. The Activity GraphQL resolver mirrors `views.schema.ts` authz (`requireObjectLevel` on the view's scope node, `requireEverythingWorkspace` for EVERYTHING). The web Activity feed subscribes to the SAME `taskEvents` realtime topic the other view surfaces already use (no new live topic) and prepends a synthetic `AuditLogEntry` for each live `task:event`, exactly mirroring the `NotificationBell`/`useLiveTasks` `@apollo/client/react` `useSubscription` pattern. Embed + Doc carry their target purely in `SavedViews.config` (no DB write), so they are pure renderer additions; the Embed URL guard is a pure, unit-tested helper. The four-type `ViewBody` `switch` in `view-surface.tsx` gains three `case`s.

**Tech Stack:** SQL Server stored procedures (`usp_AuditLog_List`, reused unchanged); `mssql` via `execSpOne`; graphql-yoga + Pothos (`@pothos/core`) GraphQL mirror (views are GraphQL-only — there is no REST view surface); `@apollo/client/react` `useSubscription` + `graphql-yoga`/`graphql-sse` realtime; vitest (`--project unit` / `--project integration`); Next.js App Router (SSR) + `next-intl`; Playwright e2e. DB work runs ONLY against local Docker `ProjectFlow_Test`.

**Prerequisite:** Phase 9d merged (the `ViewType` union + `CK_SavedViews_Type` CHECK expanded to the full set incl. `activity`/`embed`/`doc`); Phase 7 docs for the Doc view (else stub — Phase 7 is **not present today**, so Doc ships as the feature-flagged stub built in Task 9 and re-enabled when Phase 7 lands). 9e adds **NO migration**.

---

## File Structure

> **9e adds NO migration.** Activity reads the existing `dbo.AuditLog` via the existing `usp_AuditLog_List` (migration `0015` + the SP already on disk); Embed/Doc store their target in `SavedViews.config` (no schema change). The `ViewType` union + `CK_SavedViews_Type` CHECK are expanded by **9d** — this slice only registers renderers + the Activity resolver. If 9d's `ViewType` expansion is somehow missing when this slice runs, note it inline and STOP (the slice depends on it).

**API — Activity resolver + Embed URL validator + Doc resolver** (`apps/api/src/`)
- `modules/activity/embed-url.ts` — **Create.** Pure `normalizeEmbedUrl(raw)` guard: allow-list `http:`/`https:`, reject `javascript:`/`data:`/`vbscript:`/`file:`/`blob:` and anything unparseable; returns the normalized URL or throws `EmbedUrlError`. No I/O — unit-tested.
- `modules/activity/activity.repository.ts` — **Create.** `listScoped(filters)` → `usp_AuditLog_List` via `execSpOne`, mapping rows to `AuditLogEntry` (reusing the `admin.repository` `mapEntry` shape) + `TotalCount` → `AuditLogPage`.
- `modules/activity/activity.service.ts` — **Create.** `getActivity(scopeType, scopeId, workspaceId, filters)` → resolves the scope's workspace + the `Resource`/`ResourceId` narrowing, calls the repo, returns an `AuditLogPage`.
- `graphql/activity.schema.ts` — **Create.** `registerActivityGraphql()`: `AuditLogEntryType`/`AuditLogPageType` + an `activityFeed(scopeType, scopeId, workspaceId, actor, action, page, pageSize)` query, authz-gated exactly like `savedViews`.
- `graphql/schema.ts` — **Modify.** Import + call `registerActivityGraphql()` beside the other `register*Graphql()` calls.

**Types** (`packages/types/`)
- `index.ts` — **Modify.** `ViewType` already gains `'activity' | 'embed' | 'doc'` in 9d (assert, do not duplicate). Add the `config` payload shapes `EmbedViewConfig` / `DocViewConfig` and an `ActivityFilters` input type. `AuditLogEntry`/`AuditLogPage` already exist — reuse unchanged.

**Frontend — view-surface registrations + Activity feed + Embed iframe + Doc embed** (`apps/next-web/src/`)
- `components/views/view-surface.tsx` — **Modify.** Add `case 'activity' | 'embed' | 'doc'` to `ViewBody`'s `switch`, and thread the SSR-resolved Activity page + live scope.
- `components/views/activity-view.tsx` — **Create.** Reverse-chronological `AuditLogEntry` feed with live prepend (subscribes to `taskEvents`) + filter-by-actor/action.
- `components/views/embed-view.tsx` — **Create.** Sandboxed `<iframe>` with the exact `sandbox`/`referrerPolicy` attributes; reads `activeView.config.url`.
- `components/views/doc-view.tsx` — **Create.** Feature-flagged: when Phase 7 docs are present, embeds the doc reader for `config.docId`; otherwise renders the stub (the flag is OFF today).
- `lib/activity/activity-entry.ts` — **Create.** Pure `taskEventToEntry(ev)` mapping a live `taskEvents` payload → a synthetic `AuditLogEntry` for prepend; + `prependEntry(list, entry, max)`. Unit-tested.
- `server/queries/activity.ts` — **Create.** SSR helper `getActivityFeed(scopeType, scopeId, workspaceId, filters)` wrapping `gqlData` (mirrors `server/queries/views.ts`).
- `app/(app)/views/[scopeType]/[scopeId]/page.tsx` — **Modify.** When the active view's type is `activity`, SSR-fetch the first activity page and pass it to `ViewSurface`.

**i18n** (`apps/next-web/src/messages/`)
- `en.json` — **Modify.** New `Activity` + `Embed` + `Doc` namespaces.
- `id.json` — **Modify.** Same keys, real Indonesian.

**Tests**
- `apps/api/src/modules/activity/__tests__/embed-url.unit.test.ts` — **Create.** Pure Embed URL validation (allow-lists http/https; rejects `javascript:`/`data:`/`file:`/garbage).
- `apps/api/src/modules/activity/__tests__/activity-scope.unit.test.ts` — **Create.** Pure scope→audit-filter mapping + pagination math (`buildAuditFilters`).
- `apps/api/src/modules/activity/__tests__/activity.integration.test.ts` — **Create.** `activityFeed` returns only events for objects the user can see; a fresh mutation surfaces in the feed.
- `apps/next-web/src/lib/activity/__tests__/activity-entry.unit.test.ts` — **Create.** `taskEventToEntry` mapping + `prependEntry` cap/order.
- `apps/next-web/e2e/activity-embed-doc.spec.ts` — **Create.** Open an Activity view, edit a task in another tab, see the event appear; add an Embed view with a URL and see the iframe.

---

## Tasks

### Task 1: Types — `ViewType` assertion + `config` shapes + `ActivityFilters`

**Files:**
- Modify: `packages/types/index.ts` (the Views Engine block, ~lines 972–1009; `AuditLogEntry`/`AuditLogPage` already at ~723–743)
- Test: type-only; verified by `npm run build` in later tasks.

Steps:

- [ ] Confirm 9d expanded `ViewType`. Read line 974 of `packages/types/index.ts`. It MUST already read (post-9d):
```ts
export type ViewType =
  | 'list' | 'board' | 'table' | 'calendar'
  | 'workload' | 'box' | 'gantt' | 'timeline'
  | 'activity' | 'map' | 'mindmap' | 'embed' | 'chat' | 'doc';
```
If `'activity' | 'embed' | 'doc'` are NOT present, 9d has not landed — STOP and surface that the prerequisite is missing. Do **not** redefine `ViewType` here.

- [ ] Add the new `config` payload shapes + the Activity filter input directly after the `ViewConfig` interface (~line 995). `EmbedViewConfig`/`DocViewConfig` extend the base `ViewConfig` so the existing `SavedView.config` field stays a single type — the renderer reads the extra fields off `activeView.config`:

```ts
// ── Phase 9e — Embed / Doc / Activity view config payloads ──────────────────
// Embed/Doc carry their target IN SavedViews.config (no DB column). The base
// ViewConfig fields (filter/sort) stay valid+ignored for these presentation-only
// types; the renderer reads the type-specific field below off activeView.config.

/** Embed view: an external URL rendered in a sandboxed iframe. The URL is
 *  normalized + scheme-allow-listed server-side (see normalizeEmbedUrl) before
 *  it is ever persisted, so the client trusts `config.url` as already-safe. */
export interface EmbedViewConfig extends ViewConfig {
  url: string;
}

/** Doc view: a pinned Phase 7 doc id. Feature-flagged until Phase 7 docs land. */
export interface DocViewConfig extends ViewConfig {
  docId: string;
}

/** Activity feed filters (actor + action), passed to the activityFeed query. */
export interface ActivityFilters {
  actor?:    string | null;  // AuditLog.UserId
  action?:   string | null;  // AuditLog.Action (CREATE|UPDATE|DELETE|…)
  resource?: string | null;  // AuditLog.Resource (Task|List|…)
  page?:     number;
  pageSize?: number;
}
```

- [ ] Run: `npm run build --workspace packages/types` (or the repo's type build). Expected: PASS — no type errors.

- [ ] Commit:
```
git add packages/types/index.ts
git commit -m "feat(9e): types — EmbedViewConfig/DocViewConfig/ActivityFilters over the 9d ViewType union"
```

---

### Task 2: Pure Embed URL validator + unit test

**Files:**
- Create: `apps/api/src/modules/activity/embed-url.ts`
- Create: `apps/api/src/modules/activity/__tests__/embed-url.unit.test.ts`

Steps:

- [ ] Write the failing unit test first. `embed-url.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeEmbedUrl, EmbedUrlError } from '../embed-url.js';

describe('normalizeEmbedUrl', () => {
  it('accepts and normalizes an https URL', () => {
    expect(normalizeEmbedUrl('https://example.com/dashboard')).toBe('https://example.com/dashboard');
  });

  it('accepts an http URL', () => {
    expect(normalizeEmbedUrl('http://example.com/')).toBe('http://example.com/');
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(normalizeEmbedUrl('  https://example.com/x  ')).toBe('https://example.com/x');
  });

  it('rejects javascript: scheme', () => {
    expect(() => normalizeEmbedUrl('javascript:alert(1)')).toThrow(EmbedUrlError);
  });

  it('rejects a case/space-obfuscated javascript: scheme', () => {
    expect(() => normalizeEmbedUrl('  JaVaScRiPt:alert(1)')).toThrow(EmbedUrlError);
  });

  it('rejects data: scheme', () => {
    expect(() => normalizeEmbedUrl('data:text/html,<script>alert(1)</script>')).toThrow(EmbedUrlError);
  });

  it('rejects vbscript: scheme', () => {
    expect(() => normalizeEmbedUrl('vbscript:msgbox(1)')).toThrow(EmbedUrlError);
  });

  it('rejects file: scheme', () => {
    expect(() => normalizeEmbedUrl('file:///etc/passwd')).toThrow(EmbedUrlError);
  });

  it('rejects blob: scheme', () => {
    expect(() => normalizeEmbedUrl('blob:https://example.com/uuid')).toThrow(EmbedUrlError);
  });

  it('rejects a scheme-relative URL (no scheme to validate)', () => {
    expect(() => normalizeEmbedUrl('//example.com/x')).toThrow(EmbedUrlError);
  });

  it('rejects unparseable garbage', () => {
    expect(() => normalizeEmbedUrl('not a url')).toThrow(EmbedUrlError);
  });

  it('rejects an empty string', () => {
    expect(() => normalizeEmbedUrl('')).toThrow(EmbedUrlError);
  });
});
```

- [ ] Run: `npm test --workspace apps/api -- embed-url`. Expected: FAIL — `Cannot find module '../embed-url.js'`.

- [ ] Write `apps/api/src/modules/activity/embed-url.ts`. Use the WHATWG `URL` parser (handles obfuscation: `URL` lowercases + canonicalizes the scheme, so `JaVaScRiPt:` parses to `protocol === 'javascript:'`) and an allow-list — never a deny-list of the scheme string:

```ts
/** Thrown when an embed URL is missing, unparseable, or uses a disallowed
 *  scheme. Surfaced as a clean validation error by the resolver. */
export class EmbedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbedUrlError';
  }
}

/** Only these two schemes may ever be loaded into the embed iframe. An
 *  allow-list (not a deny-list) is the safe default: anything not explicitly
 *  http/https — javascript:, data:, vbscript:, file:, blob:, custom app
 *  schemes — is rejected. The WHATWG URL parser canonicalizes + lowercases
 *  the scheme, so case/whitespace obfuscation (`  JaVaScRiPt:`) is neutralized
 *  before this check runs. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Validate + normalize an external embed URL. Returns the canonical absolute
 * URL string when it parses to an allow-listed scheme; throws EmbedUrlError
 * otherwise. Pure — no network, no I/O.
 */
export function normalizeEmbedUrl(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) {
    throw new EmbedUrlError('Embed URL is required');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new EmbedUrlError('Embed URL must be an absolute http(s) URL');
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new EmbedUrlError(`Embed URL scheme '${parsed.protocol}' is not allowed (use http or https)`);
  }
  return parsed.toString();
}
```

- [ ] Run: `npm test --workspace apps/api -- embed-url`. Expected: PASS (12 tests).

- [ ] Commit:
```
git add apps/api/src/modules/activity/embed-url.ts apps/api/src/modules/activity/__tests__/embed-url.unit.test.ts
git commit -m "feat(9e): pure embed-url validator — http/https allow-list, rejects javascript:/data:/file:/blob: + unit tests"
```

---

### Task 3: Activity scope→filter mapping (pure) + unit test

**Files:**
- Create: `apps/api/src/modules/activity/activity-scope.ts`
- Create: `apps/api/src/modules/activity/__tests__/activity-scope.unit.test.ts`

The Activity feed is scoped to a view's hierarchy node. The audit log is keyed by `(WorkspaceId, Resource, ResourceId)` — there is no node column — so a SPACE/FOLDER/LIST scope narrows to the **workspace** of the node plus the optional `Resource`/`ResourceId` actor/action filters; the per-object object-level filter is enforced downstream (Task 4 filters out entries the user can't read). EVERYTHING is workspace-wide. This task extracts the pure mapping + clamping so it is testable without a DB.

Steps:

- [ ] Write the failing unit test first. `activity-scope.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildAuditFilters, clampPage } from '../activity-scope.js';

describe('clampPage', () => {
  it('defaults page to 1 and pageSize to 50', () => {
    expect(clampPage({})).toEqual({ page: 1, pageSize: 50 });
  });
  it('floors and lower-bounds page at 1', () => {
    expect(clampPage({ page: 0 })).toEqual({ page: 1, pageSize: 50 });
    expect(clampPage({ page: -3 })).toEqual({ page: 1, pageSize: 50 });
  });
  it('caps pageSize at 200', () => {
    expect(clampPage({ pageSize: 9999 })).toEqual({ page: 1, pageSize: 200 });
  });
  it('lower-bounds pageSize at 1', () => {
    expect(clampPage({ pageSize: 0 })).toEqual({ page: 1, pageSize: 50 });
  });
});

describe('buildAuditFilters', () => {
  it('maps a workspace + actor/action/resource filter through', () => {
    const f = buildAuditFilters('ws-1', { actor: 'u-9', action: 'UPDATE', resource: 'Task', page: 2, pageSize: 25 });
    expect(f).toEqual({ workspaceId: 'ws-1', userId: 'u-9', action: 'UPDATE', resource: 'Task', page: 2, pageSize: 25 });
  });
  it('omits empty/blank actor and action (treated as no-filter)', () => {
    const f = buildAuditFilters('ws-1', { actor: '', action: null });
    expect(f.userId).toBeUndefined();
    expect(f.action).toBeUndefined();
    expect(f.workspaceId).toBe('ws-1');
    expect(f).toMatchObject({ page: 1, pageSize: 50 });
  });
});
```

- [ ] Run: `npm test --workspace apps/api -- activity-scope`. Expected: FAIL — module not found.

- [ ] Write `apps/api/src/modules/activity/activity-scope.ts`:

```ts
import type { ActivityFilters } from '@projectflow/types';

/** Max audit page — bounds a client-supplied pageSize (mirror of the views
 *  engine MAX_PAGE_SIZE). */
const MAX_PAGE_SIZE = 200;

export interface AuditFilters {
  workspaceId: string;
  userId?:     string;
  action?:     string;
  resource?:   string;
  resourceId?: string;
  page:        number;
  pageSize:    number;
}

/** Clamp page/pageSize into a sane integer range. */
export function clampPage(f: { page?: number; pageSize?: number }): { page: number; pageSize: number } {
  const page = Math.max(1, Math.floor(Number(f.page) || 1));
  const requested = f.pageSize == null ? 50 : Math.floor(Number(f.pageSize) || 0);
  const pageSize = requested < 1 ? 50 : Math.min(requested, MAX_PAGE_SIZE);
  return { page, pageSize };
}

/** Treat empty string / null / undefined as "no filter". */
function nz(v: string | null | undefined): string | undefined {
  const s = (v ?? '').trim();
  return s.length ? s : undefined;
}

/**
 * Map a resolved workspace + the actor/action/resource Activity filters onto the
 * usp_AuditLog_List parameter shape. The hierarchy-node scoping itself is the
 * workspace narrowing here; the per-object visibility filter is applied AFTER the
 * SP read (the audit log has no node ACL of its own).
 */
export function buildAuditFilters(workspaceId: string, filters: ActivityFilters): AuditFilters {
  const { page, pageSize } = clampPage(filters);
  return {
    workspaceId,
    userId:   nz(filters.actor),
    action:   nz(filters.action),
    resource: nz(filters.resource),
    page,
    pageSize,
  };
}
```

- [ ] Run: `npm test --workspace apps/api -- activity-scope`. Expected: PASS (6 tests).

- [ ] Commit:
```
git add apps/api/src/modules/activity/activity-scope.ts apps/api/src/modules/activity/__tests__/activity-scope.unit.test.ts
git commit -m "feat(9e): pure activity scope→audit-filter mapping + page clamp + unit tests"
```

---

### Task 4: Activity repository + service (scoped `usp_AuditLog_List` + object-level filter)

**Files:**
- Create: `apps/api/src/modules/activity/activity.repository.ts`
- Create: `apps/api/src/modules/activity/activity.service.ts`

The repository calls the **existing** `usp_AuditLog_List` (do NOT modify the SP). The service resolves the view scope's workspace (reusing `CustomFieldRepository.getScopeNode`, exactly as `view.service.ts` does), builds the audit filters, reads the page, then applies the requesting user's **object-level filter** so a card/feed never returns an event for an object the user couldn't read directly (spec §8.2). Visibility is enforced via `accessService` on each entry's `(Resource, ResourceId)` when the resource is a hierarchy object; non-hierarchy / null-id entries fall back to workspace membership (already proven by the scope resolution).

Steps:

- [ ] Write `activity.repository.ts` — reuse the `admin.repository` `mapEntry` row mapping (copy it; the AuditLog row shape is identical), returning an `AuditLogPage`:

```ts
import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { AuditLogEntry, AuditLogPage } from '@projectflow/types';
import type { AuditFilters } from './activity-scope.js';

/** Map a raw AuditLog row → AuditLogEntry (mirrors admin.repository.mapEntry —
 *  same physical columns from usp_AuditLog_List). */
function mapEntry(r: any): AuditLogEntry {
  return {
    id:          r.Id,
    workspaceId: r.WorkspaceId ?? null,
    userId:      r.UserId,
    userEmail:   r.UserEmail ?? null,
    action:      r.Action,
    resource:    r.Resource,
    resourceId:  r.ResourceId ?? null,
    oldValues:   r.OldValues ? safeJson(r.OldValues) : null,
    newValues:   r.NewValues ? safeJson(r.NewValues) : null,
    ipAddress:   r.IpAddress ?? null,
    userAgent:   r.UserAgent ?? null,
    createdAt:   r.CreatedAt instanceof Date ? r.CreatedAt.toISOString() : String(r.CreatedAt),
  };
}

function safeJson(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return null; }
}

export class ActivityRepository {
  /** Scoped, paginated audit read via the existing usp_AuditLog_List. */
  async listScoped(f: AuditFilters): Promise<AuditLogPage> {
    const rows = await execSpOne<any>('dbo.usp_AuditLog_List', [
      { name: 'WorkspaceId', type: sql.NVarChar(255), value: f.workspaceId },
      { name: 'UserId',      type: sql.NVarChar(255), value: f.userId     ?? null },
      { name: 'Resource',    type: sql.NVarChar(100), value: f.resource   ?? null },
      { name: 'Action',      type: sql.NVarChar(50),  value: f.action     ?? null },
      { name: 'ResourceId',  type: sql.NVarChar(255), value: f.resourceId ?? null },
      { name: 'FromDate',    type: sql.DateTime2,     value: null },
      { name: 'ToDate',      type: sql.DateTime2,     value: null },
      { name: 'Page',        type: sql.Int,           value: f.page },
      { name: 'PageSize',    type: sql.Int,           value: f.pageSize },
    ]);
    const total   = rows[0]?.TotalCount ?? 0;
    const entries = rows.map(mapEntry);
    return { entries, total, page: f.page, pageSize: f.pageSize };
  }
}

export const activityRepository = new ActivityRepository();
```

- [ ] Write `activity.service.ts` — resolve the scope's workspace (EVERYTHING uses the supplied workspaceId; node scopes resolve via `getScopeNode`), build filters, read the page, then drop any entry the user can't read at the object level:

```ts
import { CustomFieldRepository } from '../customfields/customfield.repository.js';
import { accessService } from '../access/access.service.js';
import { buildAuditFilters } from './activity-scope.js';
import { activityRepository } from './activity.repository.js';
import type { ActivityFilters, AuditLogPage, AuditLogEntry } from '@projectflow/types';

type ScopeType = 'LIST' | 'FOLDER' | 'SPACE' | 'EVERYTHING';

// Audit `Resource` strings that map onto a hierarchy object we can object-level
// check. Everything else (User, Workspace, Webhook, …) is workspace-level and is
// already covered by the workspace scoping, so it passes through.
const HIERARCHY_RESOURCE: Record<string, 'SPACE' | 'FOLDER' | 'LIST' | undefined> = {
  Space: 'SPACE', Project: 'SPACE', Folder: 'FOLDER', List: 'LIST',
};

const cfRepo = new CustomFieldRepository();

export class ActivityService {
  /**
   * Hierarchy-scoped, object-level-filtered, paginated audit feed for an Activity
   * view. The caller has ALREADY passed the resolver's authz gate (VIEW on the
   * scope node, or workspace.read for EVERYTHING); here we resolve the workspace,
   * read the page, then strip entries pointing at hierarchy objects the user can't
   * read — so the feed never leaks an event for an object they couldn't open.
   */
  async getActivity(
    userId: string,
    scopeType: ScopeType,
    scopeId: string | null,
    workspaceId: string | undefined,
    filters: ActivityFilters,
  ): Promise<AuditLogPage> {
    const ws = await this.resolveWorkspace(scopeType, scopeId, workspaceId);
    const page = await activityRepository.listScoped(buildAuditFilters(ws, filters));
    const visible: AuditLogEntry[] = [];
    for (const e of page.entries) {
      if (await this.canSee(userId, e)) visible.push(e);
    }
    // total stays the unfiltered SP count (visibility is a per-page narrowing; an
    // exact filtered count would require re-reading every page — acceptable for v1,
    // logged in DECISIONS).
    return { ...page, entries: visible };
  }

  private async resolveWorkspace(
    scopeType: ScopeType,
    scopeId: string | null,
    workspaceId: string | undefined,
  ): Promise<string> {
    if (scopeType === 'EVERYTHING') {
      if (!workspaceId) throw new Error('EVERYTHING scope requires a workspaceId');
      return workspaceId;
    }
    if (!scopeId) throw new Error(`scopeId required for ${scopeType} scope`);
    const node = await cfRepo.getScopeNode(scopeType as any, scopeId);
    if (!node) throw new Error('Scope node not found');
    return node.workspaceId;
  }

  private async canSee(userId: string, e: AuditLogEntry): Promise<boolean> {
    const nodeType = HIERARCHY_RESOURCE[e.resource];
    if (!nodeType || !e.resourceId) return true; // workspace-level event → already scoped
    return accessService.can(userId, nodeType, e.resourceId, 'VIEW');
  }
}

export const activityService = new ActivityService();
```

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: PASS — no type errors.

- [ ] Commit:
```
git add apps/api/src/modules/activity/activity.repository.ts apps/api/src/modules/activity/activity.service.ts
git commit -m "feat(9e): activity repo + service — scoped usp_AuditLog_List read + object-level visibility filter"
```

---

### Task 5: GraphQL `activityFeed` resolver + integration test

**Files:**
- Create: `apps/api/src/graphql/activity.schema.ts`
- Modify: `apps/api/src/graphql/schema.ts` (import + call `registerActivityGraphql()` beside the other registrations, ~line 723)
- Create: `apps/api/src/modules/activity/__tests__/activity.integration.test.ts`

Steps:

- [ ] Write the failing integration test first (copy the harness imports the views integration tests use — `testServer.js`, `truncate.js`, `factories.js` — and drive GraphQL via the same `request('/graphql', …)` path):

```ts
/**
 * Phase 9e — Activity view integration coverage.
 * Drives the activityFeed GraphQL resolver against the REAL SQL + audit stack.
 * DB SAFETY: must target local Docker ProjectFlow_Test (see e2e/README).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

const FEED = /* GraphQL */ `
  query Activity($scopeType: String!, $scopeId: String, $workspaceId: String) {
    activityFeed(scopeType: $scopeType, scopeId: $scopeId, workspaceId: $workspaceId) {
      total
      entries { id action resource resourceId userId }
    }
  }
`;

async function gql(token: string, query: string, variables: Record<string, unknown>) {
  const res = await request('/graphql', { method: 'POST', token, json: { query, variables } });
  return json<{ data?: any; errors?: any[] }>(res);
}

describe('activityFeed', () => {
  it('returns audit entries for a SPACE the user can view', async () => {
    const owner = await createTestUser({ email: `act-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const space = await createTestProject(ws.Id, owner.accessToken, { name: 'Act Space', key: `AC${Date.now() % 100000}` });
    // A task create writes an AuditLog row (audit.middleware) within the workspace.
    await request('/tasks', {
      method: 'POST', token: owner.accessToken,
      json: { projectId: space.Id, workspaceId: ws.Id, title: 'Audited task' },
    });
    const body = await gql(owner.accessToken, FEED, { scopeType: 'EVERYTHING', scopeId: null, workspaceId: ws.Id });
    expect(body.errors).toBeUndefined();
    expect(body.data.activityFeed.total).toBeGreaterThan(0);
    expect(body.data.activityFeed.entries.length).toBeGreaterThan(0);
  });

  it('a non-member gets FORBIDDEN/NOT_FOUND (no cross-workspace leak)', async () => {
    const owner = await createTestUser({ email: `act-o-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const outsider = await createTestUser({ email: `act-x-${Date.now()}@projectflow.test` });
    const body = await gql(outsider.accessToken, FEED, { scopeType: 'EVERYTHING', scopeId: null, workspaceId: ws.Id });
    expect(body.errors?.length).toBeGreaterThan(0);
    expect(body.data?.activityFeed ?? null).toBeNull();
  });

  it('a freshly created task appears in the feed for a member', async () => {
    const owner = await createTestUser({ email: `act-f-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const space = await createTestProject(ws.Id, owner.accessToken, { name: 'Feed Space', key: `FE${Date.now() % 100000}` });
    const before = await gql(owner.accessToken, FEED, { scopeType: 'EVERYTHING', scopeId: null, workspaceId: ws.Id });
    const beforeTotal = before.data.activityFeed.total;
    await request('/tasks', {
      method: 'POST', token: owner.accessToken,
      json: { projectId: space.Id, workspaceId: ws.Id, title: 'New audited task' },
    });
    const after = await gql(owner.accessToken, FEED, { scopeType: 'EVERYTHING', scopeId: null, workspaceId: ws.Id });
    expect(after.data.activityFeed.total).toBeGreaterThan(beforeTotal);
  });
});
```

- [ ] Run: `npm run test:integration --workspace apps/api -- activity` against `ProjectFlow_Test`. Expected: FAIL — `activityFeed` field does not exist.

- [ ] Write `activity.schema.ts` — mirror `views.schema.ts`'s authz (scope-type assertion, `requireObjectLevel` for node scopes, `requireEverythingWorkspace` for EVERYTHING), exposing `AuditLogEntry`/`AuditLogPage`:

```ts
import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { activityService } from '../modules/activity/activity.service.js';
import { requireObjectLevel, requireWorkspacePermission } from './authz.js';
import type { GQLContext } from './context.js';
import type { AuditLogEntry, AuditLogPage, HierarchyNodeType } from '@projectflow/types';

type ScopeType = 'LIST' | 'FOLDER' | 'SPACE' | 'EVERYTHING';
const SCOPE_TYPES: readonly ScopeType[] = ['LIST', 'FOLDER', 'SPACE', 'EVERYTHING'];

function assertScopeType(s: string): ScopeType {
  if (!(SCOPE_TYPES as readonly string[]).includes(s)) {
    throw new GraphQLError(`Invalid scopeType '${s}' (expected one of: ${SCOPE_TYPES.join(', ')})`, { extensions: { code: 'BAD_REQUEST' } });
  }
  return s as ScopeType;
}

function authzNode(scopeType: ScopeType): HierarchyNodeType | null {
  return scopeType === 'EVERYTHING' ? null : (scopeType as HierarchyNodeType);
}

async function requireEverythingWorkspace(ctx: GQLContext, workspaceId: string | null | undefined): Promise<void> {
  if (!workspaceId) throw new GraphQLError('workspaceId is required for EVERYTHING-scoped activity', { extensions: { code: 'BAD_REQUEST' } });
  await requireWorkspacePermission(ctx, workspaceId, 'workspace.read');
}

function requireUser(ctx: GQLContext): string {
  if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
  return ctx.user.userId;
}

export function registerActivityGraphql(): void {
  const EntryType = builder.objectRef<AuditLogEntry>('AuditLogEntry');
  EntryType.implement({ fields: (t) => ({
    id:          t.exposeString('id'),
    workspaceId: t.string({ nullable: true, resolve: (e) => e.workspaceId }),
    userId:      t.exposeString('userId'),
    userEmail:   t.string({ nullable: true, resolve: (e) => e.userEmail }),
    action:      t.exposeString('action'),
    resource:    t.exposeString('resource'),
    resourceId:  t.string({ nullable: true, resolve: (e) => e.resourceId }),
    oldValues:   t.string({ nullable: true, resolve: (e) => (e.oldValues ? JSON.stringify(e.oldValues) : null) }),
    newValues:   t.string({ nullable: true, resolve: (e) => (e.newValues ? JSON.stringify(e.newValues) : null) }),
    createdAt:   t.field({ type: 'Date', resolve: (e) => new Date(e.createdAt) }),
  }) });

  const PageType = builder.objectRef<AuditLogPage>('AuditLogPage');
  PageType.implement({ fields: (t) => ({
    total:    t.exposeInt('total'),
    page:     t.exposeInt('page'),
    pageSize: t.exposeInt('pageSize'),
    entries:  t.field({ type: [EntryType], resolve: (p) => p.entries }),
  }) });

  builder.queryFields((t) => ({
    activityFeed: t.field({
      type: PageType,
      args: {
        scopeType:   t.arg.string({ required: true }),
        scopeId:     t.arg.string({ required: false }),
        workspaceId: t.arg.string({ required: false }),
        actor:       t.arg.string({ required: false }),
        action:      t.arg.string({ required: false }),
        resource:    t.arg.string({ required: false }),
        page:        t.arg.int({ required: false }),
        pageSize:    t.arg.int({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        const userId = requireUser(ctx);
        const scopeType = assertScopeType(a.scopeType);
        const node = authzNode(scopeType);
        if (node) await requireObjectLevel(ctx, node, a.scopeId, 'VIEW');
        else await requireEverythingWorkspace(ctx, a.workspaceId);
        return activityService.getActivity(userId, scopeType, a.scopeId ?? null, a.workspaceId ?? undefined, {
          actor:    a.actor    ?? null,
          action:   a.action   ?? null,
          resource: a.resource ?? null,
          page:     a.page     ?? 1,
          pageSize: a.pageSize ?? 50,
        });
      },
    }),
  }));
}
```

- [ ] Wire it into `schema.ts` — add the import alongside the others and call it near the other `register*Graphql()` calls (after the root Query/Mutation types exist, ~line 723):

```ts
import { registerActivityGraphql } from './activity.schema.js';
```
```ts
// ─────────────────────────────────────────
// Activity (Phase 9e) — AuditLogEntry/AuditLogPage + activityFeed query over the
// scoped, object-level-filtered audit log. No mutations (read-only lens).
// ─────────────────────────────────────────
registerActivityGraphql();
```

- [ ] Run: `npm run test:integration --workspace apps/api -- activity` against `ProjectFlow_Test`. Expected: PASS (3 tests). Then `npm run build --workspace apps/api`. Expected: PASS (Pothos schema builds).

- [ ] Commit:
```
git add apps/api/src/graphql/activity.schema.ts apps/api/src/graphql/schema.ts apps/api/src/modules/activity/__tests__/activity.integration.test.ts
git commit -m "feat(9e): GraphQL activityFeed resolver (authz-mirrored) + AuditLogEntry/Page types + integration test"
```

---

### Task 6: SSR activity query + client live-prepend helper + unit test

**Files:**
- Create: `apps/next-web/src/server/queries/activity.ts`
- Create: `apps/next-web/src/lib/activity/activity-entry.ts`
- Create: `apps/next-web/src/lib/activity/__tests__/activity-entry.unit.test.ts`
- Note: read `apps/next-web/node_modules/next/dist/docs/` per `apps/next-web/AGENTS.md` before writing web code (this Next.js has breaking changes).

Steps:

- [ ] Write the SSR query helper `server/queries/activity.ts` — mirror `server/queries/views.ts`'s `gqlData` wrapper (re-export it or import it; it already lives there):

```ts
import 'server-only';
import { cache } from 'react';
import type { AuditLogPage, ViewScopeType, ActivityFilters } from '@projectflow/types';
import { gqlData } from './views';

const ACTIVITY_FEED_QUERY = /* GraphQL */ `
  query ActivityFeed(
    $scopeType: String!, $scopeId: String, $workspaceId: String,
    $actor: String, $action: String, $resource: String, $page: Int, $pageSize: Int
  ) {
    activityFeed(
      scopeType: $scopeType, scopeId: $scopeId, workspaceId: $workspaceId,
      actor: $actor, action: $action, resource: $resource, page: $page, pageSize: $pageSize
    ) {
      total
      page
      pageSize
      entries {
        id workspaceId userId userEmail action resource resourceId
        oldValues newValues createdAt
      }
    }
  }
`;

/** Raw entries arrive with oldValues/newValues as JSON strings (the schema
 *  serializes them); parse back to objects for the AuditLogEntry shape. */
interface RawEntry { oldValues: string | null; newValues: string | null; [k: string]: unknown }

function parseEntry(e: RawEntry): any {
  const safe = (s: string | null) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
  return { ...e, oldValues: safe(e.oldValues), newValues: safe(e.newValues) };
}

/** First page of the scoped Activity feed (SSR seed; the client prepends live). */
export const getActivityFeed = cache(async (
  scopeType: ViewScopeType,
  scopeId: string | null,
  workspaceId: string | undefined,
  filters: ActivityFilters = {},
): Promise<AuditLogPage> => {
  const { activityFeed } = await gqlData<{ activityFeed: { total: number; page: number; pageSize: number; entries: RawEntry[] } }>(
    ACTIVITY_FEED_QUERY,
    {
      scopeType,
      scopeId: scopeId ?? null,
      workspaceId: workspaceId ?? null,
      actor: filters.actor ?? null,
      action: filters.action ?? null,
      resource: filters.resource ?? null,
      page: filters.page ?? 1,
      pageSize: filters.pageSize ?? 50,
    },
  );
  return {
    total: activityFeed?.total ?? 0,
    page: activityFeed?.page ?? 1,
    pageSize: activityFeed?.pageSize ?? 50,
    entries: (activityFeed?.entries ?? []).map(parseEntry),
  };
});
```

- [ ] Write the failing unit test for the pure live-prepend helper. `activity-entry.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { taskEventToEntry, prependEntry } from '../activity-entry';
import type { AuditLogEntry } from '@projectflow/types';

const base: AuditLogEntry = {
  id: 'a1', workspaceId: 'ws', userId: 'u', userEmail: null,
  action: 'UPDATE', resource: 'Task', resourceId: 't0',
  oldValues: null, newValues: null, ipAddress: null, userAgent: null,
  createdAt: '2026-06-07T00:00:00.000Z',
};

describe('taskEventToEntry', () => {
  it('maps a created task event to a CREATE Task entry', () => {
    const e = taskEventToEntry({ kind: 'created', taskId: 't9', task: { id: 't9', title: 'X' } });
    expect(e).not.toBeNull();
    expect(e!.action).toBe('CREATE');
    expect(e!.resource).toBe('Task');
    expect(e!.resourceId).toBe('t9');
  });
  it('maps updated/deleted to UPDATE/DELETE', () => {
    expect(taskEventToEntry({ kind: 'updated', taskId: 't1', task: { id: 't1' } })!.action).toBe('UPDATE');
    expect(taskEventToEntry({ kind: 'deleted', taskId: 't2' })!.action).toBe('DELETE');
  });
  it('returns null when no task id can be resolved', () => {
    expect(taskEventToEntry({ kind: 'updated' } as any)).toBeNull();
  });
});

describe('prependEntry', () => {
  it('prepends and de-dupes by id', () => {
    const list = prependEntry([base], { ...base, id: 'a2' }, 50);
    expect(list.map((e) => e.id)).toEqual(['a2', 'a1']);
    const again = prependEntry(list, { ...base, id: 'a2' }, 50);
    expect(again.map((e) => e.id)).toEqual(['a2', 'a1']); // no duplicate
  });
  it('caps the list length', () => {
    const seed = Array.from({ length: 3 }, (_, i) => ({ ...base, id: `x${i}` }));
    const out = prependEntry(seed, { ...base, id: 'new' }, 3);
    expect(out).toHaveLength(3);
    expect(out[0].id).toBe('new');
  });
});
```

- [ ] Run: `npm test --workspace apps/next-web -- activity-entry`. Expected: FAIL — module not found.

- [ ] Write `apps/next-web/src/lib/activity/activity-entry.ts`:

```ts
import type { AuditLogEntry } from '@projectflow/types';

/** The live taskEvents payload shape (see operations.ts TASK_EVENTS). */
export interface LiveTaskEvent {
  kind: 'created' | 'updated' | 'deleted';
  taskId?: string | null;
  task?: { id?: string | null; title?: string | null } | null;
}

const KIND_ACTION: Record<LiveTaskEvent['kind'], string> = {
  created: 'CREATE', updated: 'UPDATE', deleted: 'DELETE',
};

/**
 * Map a live task event → a synthetic AuditLogEntry so the Activity feed can
 * prepend it immediately (the real audit row lands async via the middleware on
 * the next SSR re-seed). Returns null when no task id is resolvable.
 */
export function taskEventToEntry(ev: LiveTaskEvent): AuditLogEntry | null {
  const id = ev.task?.id ?? ev.taskId ?? null;
  if (!id) return null;
  return {
    id:          `live:${id}:${ev.kind}:${Date.now()}`,
    workspaceId: null,
    userId:      'live',
    userEmail:   null,
    action:      KIND_ACTION[ev.kind],
    resource:    'Task',
    resourceId:  id,
    oldValues:   null,
    newValues:   ev.task ? { title: ev.task.title ?? null } : null,
    ipAddress:   null,
    userAgent:   null,
    createdAt:   new Date().toISOString(),
  };
}

/** Prepend an entry, de-dupe by id, and cap the feed length. Pure. */
export function prependEntry(list: AuditLogEntry[], entry: AuditLogEntry, max: number): AuditLogEntry[] {
  if (list.some((e) => e.id === entry.id)) return list;
  return [entry, ...list].slice(0, Math.max(1, max));
}
```

- [ ] Run: `npm test --workspace apps/next-web -- activity-entry`. Expected: PASS (6 tests).

- [ ] Commit:
```
git add apps/next-web/src/server/queries/activity.ts apps/next-web/src/lib/activity/activity-entry.ts apps/next-web/src/lib/activity/__tests__/activity-entry.unit.test.ts
git commit -m "feat(9e): SSR activity feed query + pure live-prepend helper (taskEvent→AuditLogEntry) + unit tests"
```

---

### Task 7: Activity view renderer (feed + live prepend + actor/action filter)

**Files:**
- Create: `apps/next-web/src/components/views/activity-view.tsx`
- Modify: `apps/next-web/src/messages/en.json` (add `Activity` namespace)
- Modify: `apps/next-web/src/messages/id.json` (same keys, Indonesian)

Steps:

- [ ] Write `activity-view.tsx` — a client component that seeds from the SSR `AuditLogPage`, subscribes to `taskEvents` (the SAME topic the other surfaces use, via `@apollo/client/react` `useSubscription` + the existing `TASK_EVENTS` operation), prepends each live event as a synthetic entry, and renders a reverse-chronological feed with a client-side actor/action filter. Mirrors `calendar-view.tsx`'s `useSubscription`/`live` wiring and `NotificationBell`'s subscription pattern:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { useSubscription } from '@apollo/client/react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { TASK_EVENTS } from '@/lib/realtime/operations';
import { taskEventToEntry, prependEntry, type LiveTaskEvent } from '@/lib/activity/activity-entry';
import type { LiveScopeProp } from '@/components/views/view-surface';
import type { AuditLogEntry, AuditLogPage } from '@projectflow/types';

interface Props {
  /** SSR-seeded first page of the scoped feed. Null only when not yet fetched. */
  activityPage: AuditLogPage | null;
  /** Live-subscription scope (drives the taskEvents subscription), from the page. */
  live: LiveScopeProp;
}

const MAX_FEED = 200;

export function ActivityView({ activityPage, live }: Props) {
  const t = useTranslations('Activity');
  const [entries, setEntries] = useState<AuditLogEntry[]>(activityPage?.entries ?? []);
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');

  const projectId = live.projectId ?? null;
  const workspaceId = live.workspaceId ?? null;
  const enabled = Boolean(projectId || workspaceId);

  // Same realtime topic the task views subscribe to — no new live channel. Each
  // event becomes a synthetic AuditLogEntry prepended to the feed; the canonical
  // audit row arrives on the next SSR re-seed.
  useSubscription<{ taskEvents: LiveTaskEvent }>(TASK_EVENTS, {
    variables: { projectId, workspaceId },
    skip: !enabled,
    onData: ({ data }) => {
      const ev = data.data?.taskEvents;
      if (!ev) return;
      const entry = taskEventToEntry(ev);
      if (entry) setEntries((prev) => prependEntry(prev, entry, MAX_FEED));
    },
  });

  // Distinct actors/actions for the filter dropdowns, derived from the feed.
  const actors  = useMemo(() => Array.from(new Set(entries.map((e) => e.userEmail ?? e.userId))).sort(), [entries]);
  const actions = useMemo(() => Array.from(new Set(entries.map((e) => e.action))).sort(), [entries]);

  const filtered = useMemo(
    () => entries.filter((e) =>
      (!actor  || (e.userEmail ?? e.userId) === actor) &&
      (!action || e.action === action)),
    [entries, actor, action],
  );

  return (
    <div
      data-testid="view-body-activity"
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background"
    >
      {/* Filter bar */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <select
          data-testid="activity-filter-actor"
          aria-label={t('filterActor')}
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          className="h-8 rounded border border-border bg-background px-2 text-xs"
        >
          <option value="">{t('allActors')}</option>
          {actors.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select
          data-testid="activity-filter-action"
          aria-label={t('filterAction')}
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="h-8 rounded border border-border bg-background px-2 text-xs"
        >
          <option value="">{t('allActions')}</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {/* Reverse-chronological feed */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">{t('empty')}</div>
        ) : (
          <ul className="divide-y divide-border/60">
            {filtered.map((e) => (
              <li
                key={e.id}
                data-testid="activity-entry"
                data-action={e.action}
                className="flex items-baseline gap-2 px-3 py-2 text-xs"
              >
                <span className={cn('shrink-0 rounded px-1.5 py-0.5 font-medium', actionClass(e.action))}>
                  {e.action}
                </span>
                <span className="text-foreground">{e.resource}</span>
                {e.resourceId && <span className="truncate text-muted-foreground">{e.resourceId}</span>}
                <span className="ml-auto shrink-0 text-muted-foreground">{e.userEmail ?? e.userId}</span>
                <time className="shrink-0 tabular-nums text-muted-foreground" dateTime={e.createdAt}>
                  {new Date(e.createdAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function actionClass(action: string): string {
  switch (action) {
    case 'CREATE': return 'bg-emerald-500/15 text-emerald-600';
    case 'DELETE': return 'bg-destructive/15 text-destructive';
    default:       return 'bg-primary/10 text-foreground';
  }
}
```

- [ ] Add the `Activity` namespace to `en.json`:

```json
"Activity": {
  "empty": "No activity yet",
  "filterActor": "Filter by actor",
  "filterAction": "Filter by action",
  "allActors": "All actors",
  "allActions": "All actions"
}
```

- [ ] Add the same keys to `id.json` (real Indonesian):

```json
"Activity": {
  "empty": "Belum ada aktivitas",
  "filterActor": "Saring berdasarkan pelaku",
  "filterAction": "Saring berdasarkan tindakan",
  "allActors": "Semua pelaku",
  "allActions": "Semua tindakan"
}
```

- [ ] Run: `npm test --workspace apps/next-web` (includes the `messages.unit` i18n parity test). Expected: PASS — en/id parity green.

- [ ] Commit:
```
git add apps/next-web/src/components/views/activity-view.tsx apps/next-web/src/messages/en.json apps/next-web/src/messages/id.json
git commit -m "feat(9e): Activity view — reverse-chron AuditLogEntry feed + live prepend (taskEvents) + actor/action filter + i18n"
```

---

### Task 8: Embed view renderer (sandboxed iframe)

**Files:**
- Create: `apps/next-web/src/components/views/embed-view.tsx`
- Modify: `apps/next-web/src/messages/en.json` (add `Embed` namespace)
- Modify: `apps/next-web/src/messages/id.json` (same keys, Indonesian)

Steps:

- [ ] Write `embed-view.tsx` — reads `activeView.config.url` (already server-normalized by `normalizeEmbedUrl` at create/update time), renders a sandboxed `<iframe>` with the EXACT `sandbox`/`referrerPolicy` attributes from spec §8.3, and a defensive client-side re-check so a malformed persisted config can't load an unsafe scheme:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import type { EmbedViewConfig, SavedView } from '@projectflow/types';

interface Props {
  /** The active saved view — config.url carries the external URL. */
  activeView: SavedView;
}

/** Defensive client-side re-check (server already allow-listed at write time):
 *  only http/https ever reach the iframe `src`. */
function safeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function EmbedView({ activeView }: Props) {
  const t = useTranslations('Embed');
  const config = activeView.config as EmbedViewConfig;
  const url = safeUrl(config?.url);

  if (!url) {
    return (
      <div
        data-testid="view-body-embed"
        className="flex h-full items-center justify-center rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground"
      >
        {t('noUrl')}
      </div>
    );
  }

  return (
    <div data-testid="view-body-embed" className="h-full overflow-hidden rounded-lg border border-border bg-background">
      <iframe
        data-testid="embed-iframe"
        src={url}
        title={activeView.name || t('title')}
        className="h-full w-full border-0"
        // Sandboxed: allow scripts + same-origin docs to function, but never
        // top-navigation, popups, or form-driven escapes. referrerpolicy strips
        // the referrer so the embedded site learns nothing about our origin/path.
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        loading="lazy"
        allowFullScreen
      />
    </div>
  );
}
```

- [ ] Add the `Embed` namespace to `en.json`:

```json
"Embed": {
  "title": "Embedded page",
  "noUrl": "No URL configured for this embed view"
}
```

- [ ] Add the same keys to `id.json`:

```json
"Embed": {
  "title": "Halaman tertanam",
  "noUrl": "Belum ada URL yang dikonfigurasi untuk tampilan sematan ini"
}
```

- [ ] Run: `npm test --workspace apps/next-web`. Expected: PASS — i18n parity green.

- [ ] Commit:
```
git add apps/next-web/src/components/views/embed-view.tsx apps/next-web/src/messages/en.json apps/next-web/src/messages/id.json
git commit -m "feat(9e): Embed view — sandboxed iframe (sandbox/referrerPolicy) over config.url + defensive scheme re-check + i18n"
```

---

### Task 9: Doc view renderer (feature-flagged stub) + flag

**Files:**
- Create: `apps/next-web/src/components/views/doc-view.tsx`
- Create: `apps/next-web/src/lib/feature-flags.ts` (only if no flag module exists — otherwise extend it)
- Modify: `apps/next-web/src/messages/en.json` (add `Doc` namespace)
- Modify: `apps/next-web/src/messages/id.json` (same keys, Indonesian)

> **Phase 7 docs are NOT present in this repo** (no `infra/sql/migrations/004*_docs.sql`, no `usp_Doc*` SPs, no doc-reader component — verified during grounding; the only `*doc*` UI file is an unrelated `search-docs.tsx`). Per spec deferral 4, the Doc renderer ships as a **feature-flagged stub** wired so that flipping the flag (when Phase 7 lands) lights up the real reader. Do NOT attempt to import a Phase 7 doc component that doesn't exist — the stub branch must be the only code path compiled today.

Steps:

- [ ] Add (or extend) a feature-flag module `apps/next-web/src/lib/feature-flags.ts`. If one already exists, add the constant there instead:

```ts
/** Phase 7 docs surface presence. OFF until Phase 7 (collab docs/wikis) lands;
 *  flip to true once the doc reader component + doc-read endpoint exist, then the
 *  Doc view renders the real reader (see doc-view.tsx). */
export const DOCS_FEATURE_ENABLED = false;
```

- [ ] Write `doc-view.tsx` — reads `activeView.config.docId`; when the flag is OFF it renders the stub; when ON it will render the Phase 7 reader (left as a documented TODO so the branch compiles today without a missing import):

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { DOCS_FEATURE_ENABLED } from '@/lib/feature-flags';
import type { DocViewConfig, SavedView } from '@projectflow/types';

interface Props {
  /** The active saved view — config.docId pins the Phase 7 doc. */
  activeView: SavedView;
}

export function DocView({ activeView }: Props) {
  const t = useTranslations('Doc');
  const config = activeView.config as DocViewConfig;
  const docId = typeof config?.docId === 'string' ? config.docId : null;

  // Phase 7 not present → stub. When DOCS_FEATURE_ENABLED flips true, replace the
  // body below with the Phase 7 reader, e.g.:
  //   import { DocReader } from '@/components/docs/doc-reader';
  //   return <DocReader docId={docId} readOnly />;
  if (!DOCS_FEATURE_ENABLED) {
    return (
      <div
        data-testid="view-body-doc"
        data-doc-stub="true"
        className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-8 text-center"
      >
        <div className="text-sm font-medium text-foreground">{t('comingSoonTitle')}</div>
        <div className="max-w-sm text-xs text-muted-foreground">{t('comingSoonBody')}</div>
        {docId && <code className="text-[11px] text-muted-foreground">{t('pinned', { docId })}</code>}
      </div>
    );
  }

  // Phase 7 present: render the pinned doc read-only. Kept minimal so the wiring
  // is obvious when the flag flips.
  return (
    <div data-testid="view-body-doc" className="h-full overflow-auto rounded-lg border border-border bg-background p-4">
      {docId ? (
        // TODO(phase7): <DocReader docId={docId} readOnly />
        <div className="text-sm text-foreground">{t('pinned', { docId })}</div>
      ) : (
        <div className="text-xs text-muted-foreground">{t('noDoc')}</div>
      )}
    </div>
  );
}
```

- [ ] Add the `Doc` namespace to `en.json`:

```json
"Doc": {
  "comingSoonTitle": "Doc view coming soon",
  "comingSoonBody": "The Doc view will embed a pinned document once Docs are available.",
  "pinned": "Pinned doc: {docId}",
  "noDoc": "No document pinned for this view"
}
```

- [ ] Add the same keys to `id.json`:

```json
"Doc": {
  "comingSoonTitle": "Tampilan Dokumen segera hadir",
  "comingSoonBody": "Tampilan Dokumen akan menyematkan dokumen yang dipilih setelah Dokumen tersedia.",
  "pinned": "Dokumen tersemat: {docId}",
  "noDoc": "Tidak ada dokumen yang disematkan untuk tampilan ini"
}
```

- [ ] Run: `npm test --workspace apps/next-web`. Expected: PASS — i18n parity green.

- [ ] Commit:
```
git add apps/next-web/src/components/views/doc-view.tsx apps/next-web/src/lib/feature-flags.ts apps/next-web/src/messages/en.json apps/next-web/src/messages/id.json
git commit -m "feat(9e): Doc view — feature-flagged stub (Phase 7 absent) reading config.docId, wired for flip-on + i18n"
```

---

### Task 10: Register the three renderers in `view-surface.tsx` + SSR Activity fetch

**Files:**
- Modify: `apps/next-web/src/components/views/view-surface.tsx`
- Modify: `apps/next-web/src/app/(app)/views/[scopeType]/[scopeId]/page.tsx`
- Note: read `apps/next-web/node_modules/next/dist/docs/` per `apps/next-web/AGENTS.md` before editing the page (Next 16 async params).

Steps:

- [ ] In `view-surface.tsx`, add the imports near the other view imports (after `BoardViewEngine`):

```tsx
import { ActivityView } from '@/components/views/activity-view';
import { EmbedView } from '@/components/views/embed-view';
import { DocView } from '@/components/views/doc-view';
import type { AuditLogPage } from '@projectflow/types';
```

- [ ] Thread the SSR Activity page through the surface. Add `activityPage` to the `Props` interface and the `ViewSurface` destructure, pass it into `ViewBody`, and add it to `ViewBody`'s param type:

```tsx
// In Props (after `live: LiveScopeProp;`):
  /** SSR-seeded first page of the Activity feed — present only for an `activity`
   *  active view; null otherwise. */
  activityPage?: AuditLogPage | null;
```
```tsx
// In the ViewSurface signature destructure, add `activityPage,` alongside `live,`.
// In the <ViewBody ... /> call (the active-view branch), add: activityPage={activityPage}
```
```tsx
// In ViewBody's param object + its inline type, add:
  activityPage?: AuditLogPage | null;
```

- [ ] Add the three `case`s to `ViewBody`'s `switch` (before the `default`):

```tsx
    case 'activity':
      return <ActivityView activityPage={activityPage ?? null} live={live} />;
    case 'embed':
      return <EmbedView activeView={activeView} />;
    case 'doc':
      return <DocView activeView={activeView} />;
```

- [ ] In the views `page.tsx`, SSR-fetch the Activity feed when the active view is an `activity` view, and pass it to `ViewSurface`. Add the import + the conditional fetch + the prop:

```tsx
import { getActivityFeed } from '@/server/queries/activity';
```
```tsx
// After `const live = resolveLiveScope(...)`:
  // Activity views read the audit log, not the task query — SSR-seed the first
  // page so the client renders immediately, then it prepends live taskEvents.
  const activityPage =
    activeView?.type === 'activity'
      ? await getActivityFeed(scopeType, nodeScopeId, workspaceId)
      : null;
```
```tsx
// Add to the <ViewSurface .../> props:
      activityPage={activityPage}
```

- [ ] Run: `npm run build --workspace apps/next-web`. Expected: PASS — Next build clean (the new `case`s are exhaustive over the 9d `ViewType`; `embed`/`doc`/`activity` resolve, every other new 9d type still falls through to the `default` ListView until its own slice). Then `npm test --workspace apps/next-web`. Expected: PASS.

- [ ] Commit:
```
git add apps/next-web/src/components/views/view-surface.tsx "apps/next-web/src/app/(app)/views/[scopeType]/[scopeId]/page.tsx"
git commit -m "feat(9e): register activity/embed/doc renderers in view-surface + SSR-seed Activity feed in the views page"
```

---

### Task 11: Playwright e2e (headline flow)

**Files:**
- Create: `apps/next-web/e2e/activity-embed-doc.spec.ts`
- Note: e2e runs against local Docker `ProjectFlow_Test` only (use the project's existing e2e env/setup, same as the views/realtime specs).

Steps:

- [ ] Write the e2e spec covering the spec §8.5 acceptance — open an Activity view, perform an edit in another tab, see the event appear live; add an Embed view with a URL and see the iframe. Follow the existing views/realtime spec harness (login helper, seeded scope, view-create helper) the other view specs use:

```ts
import { test, expect } from '@playwright/test';
import { loginAndSeedScope, createSavedView } from './helpers'; // existing helpers used by the views specs

test.describe('Phase 9e — Activity / Embed / Doc views', () => {
  test('Activity feed shows a live edit; Embed view renders an iframe', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const { scopeType, scopeId, taskId, taskUrl } = await loginAndSeedScope(page);

    // Create + open an Activity view on the scope.
    const activityViewId = await createSavedView(page, { scopeType, scopeId, type: 'activity', name: 'Activity' });
    await page.goto(`/views/${scopeType}/${scopeId}?viewId=${activityViewId}`);
    await expect(page.getByTestId('view-body-activity')).toBeVisible();

    const feedBefore = await page.getByTestId('activity-entry').count();

    // Second tab: edit the seeded task (a task update publishes a taskEvents event).
    const page2 = await ctx.newPage();
    await page2.goto(taskUrl);
    await page2.getByTestId('task-title-input').fill('Edited from tab 2');
    await page2.getByTestId('task-title-input').blur();

    // The Activity feed prepends a live UPDATE entry without a reload.
    await expect.poll(async () => page.getByTestId('activity-entry').count()).toBeGreaterThan(feedBefore);
    await expect(page.getByTestId('activity-entry').first()).toHaveAttribute('data-action', /CREATE|UPDATE/);

    // Add an Embed view with a URL and see the sandboxed iframe.
    const embedViewId = await createSavedView(page, {
      scopeType, scopeId, type: 'embed', name: 'Embed',
      config: { filter: { conjunction: 'AND', rules: [] }, sort: [], url: 'https://example.com/' },
    });
    await page.goto(`/views/${scopeType}/${scopeId}?viewId=${embedViewId}`);
    const iframe = page.getByTestId('embed-iframe');
    await expect(iframe).toBeVisible();
    await expect(iframe).toHaveAttribute('src', 'https://example.com/');
    await expect(iframe).toHaveAttribute('sandbox', /allow-scripts/);
    await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');

    await ctx.close();
  });
});
```

(If `createSavedView` does not yet accept a `config.url` passthrough, extend the helper to forward the full `config` object to the `createSavedView` GraphQL mutation — the schema already takes `config` as a JSON string, so the helper just `JSON.stringify`s it. Adjust the task-title selector to the real one used by the existing task-panel specs.)

- [ ] Run: the project's e2e command for a single spec against `ProjectFlow_Test` (e.g. `npx playwright test e2e/activity-embed-doc.spec.ts`). Expected: PASS (1 test) — Activity prepends the live edit; Embed iframe renders with the sandbox/referrerpolicy attributes.

- [ ] Commit:
```
git add apps/next-web/e2e/activity-embed-doc.spec.ts
git commit -m "test(9e): e2e — Activity live-edit prepend + Embed iframe (sandbox/referrerpolicy) render"
```

---

### Task 12: Slice verification + DECISIONS.md

**Files:**
- Modify: `DECISIONS.md` (append a Phase 9e entry)

Steps:

- [ ] Run the full slice verification on local Docker `ProjectFlow_Test`:
  - `npm test --workspace apps/api` — Expected: PASS (existing suite + new `embed-url`/`activity-scope` unit tests).
  - `npm run test:integration --workspace apps/api -- activity` — Expected: PASS (`activity.integration.test.ts`); then the full integration suite green.
  - `npm test --workspace apps/next-web` — Expected: PASS (unit + `activity-entry` unit + `messages.unit` parity).
  - `npm run build --workspace apps/api` and `npm run build --workspace apps/next-web` — Expected: both PASS.
  - The activity/embed/doc e2e — Expected: PASS.

- [ ] Append a `DECISIONS.md` entry logging: **no migration** (Activity reads the existing `usp_AuditLog_List`; Embed/Doc are `config`-only); the **allow-list** Embed URL guard (`http`/`https` only, WHATWG-`URL`-canonicalized so case/whitespace obfuscation is neutralized, `javascript:`/`data:`/`file:`/`blob:`/scheme-relative rejected) + the client-side defensive re-check; the **object-level post-filter** on the Activity feed (per-page visibility narrowing; `total` stays the unfiltered SP count — documented v1 tradeoff); reuse of the **same `taskEvents` realtime topic** for live prepend (no new live channel) + the synthetic-entry mapping; the iframe **`sandbox`/`referrerPolicy`** attribute choices; and that **Doc ships feature-flagged** because Phase 7 docs are absent (`DOCS_FEATURE_ENABLED=false`), wired to flip on. DB-execution-policy note: all DB work ran ONLY against local Docker `ProjectFlow_Test`.

- [ ] Commit:
```
git add DECISIONS.md
git commit -m "docs(9e): DECISIONS entry — Activity audit feed + Embed URL guard + Doc stub (no migration)"
```

---

## Definition of Done

Per-slice DoD (spec §3) + the §8.5 acceptance:

- [ ] **§8.5 acceptance:** Activity feed renders scoped events live (SSR seed + `taskEvents` live prepend, object-level filtered); Embed and Doc views render their targets (Embed → sandboxed iframe over `config.url`; Doc → feature-flagged stub reading `config.docId`, ready to flip on when Phase 7 lands).
- [ ] **No migration** — Activity reads the existing `dbo.AuditLog` via the unchanged `usp_AuditLog_List`; Embed/Doc carry their target in `SavedViews.config`. (Depends on **9d** having expanded the `ViewType` union + `CK_SavedViews_Type` CHECK; this slice asserts that and adds renderers + a resolver only.)
- [ ] **Activity resolver** (`activityFeed`) is authz-gated exactly like `savedViews` (`requireObjectLevel` VIEW on node scopes, `requireWorkspacePermission('workspace.read')` for EVERYTHING), paginated, and **object-level filters** out entries the user couldn't read directly — no cross-workspace/private-object leak.
- [ ] **Embed URL validation** is a pure, unit-tested helper: allow-lists `http`/`https`, rejects `javascript:`/`data:`/`vbscript:`/`file:`/`blob:`/scheme-relative/garbage; the iframe carries `sandbox` + `referrerPolicy="no-referrer"`; a defensive client re-check guards a malformed persisted config.
- [ ] **Live prepend** reuses the existing `taskEvents` topic (no new live channel) via `@apollo/client/react` `useSubscription`, mirroring `NotificationBell`/`useLiveTasks`.
- [ ] Unit tests (`normalizeEmbedUrl`, `buildAuditFilters`/`clampPage`, `taskEventToEntry`/`prependEntry`) + integration test (`activityFeed` scoping + a fresh mutation surfacing) + ≥1 Playwright e2e for the headline flow — all green.
- [ ] `@projectflow/types` updated (`EmbedViewConfig`/`DocViewConfig`/`ActivityFilters`; `AuditLogEntry`/`AuditLogPage` reused unchanged; `ViewType` from 9d).
- [ ] i18n: new `Activity`/`Embed`/`Doc` keys in **en.json + id.json** (real Indonesian); `messages.unit` parity green.
- [ ] All DB work (SP read, integration, e2e) ran **ONLY against local Docker `ProjectFlow_Test`** — never the prod-pointing `apps/api/.env`.
- [ ] `DECISIONS.md` entry logs the mechanism choices + the documented tradeoffs (unfiltered `total`, Doc feature flag). **Stop for review/merge before Slice 9f.**

---

## Self-Review

**Spec coverage (§8):**
- §8.1 Model — **NO migration**: Activity reads `dbo.AuditLog` via `usp_AuditLog_List` (Tasks 3–5); Embed/Doc store the target in `SavedViews.config` (Tasks 1, 8, 9). ✔
- §8.2 Backend — Activity resolver calls `usp_AuditLog_List` scoped to the view's hierarchy node (workspace narrowing via `getScopeNode`, Task 4) + the requesting user's object-level filter (`accessService.can`, Task 4), paginated (Task 3), subscribing to the realtime stream for live prepend (client, Task 7). Doc resolves a pinned doc id from `config` (Task 9). Embed validates/normalizes the URL (allow-list, no `javascript:`) (Task 2). ✔
- §8.3 Frontend — Activity reverse-chron feed + live prepend + filter-by-actor/action from `AuditLogEntry` (Task 7); Embed sandboxed `<iframe>` with `sandbox`/`referrerPolicy` (Task 8); Doc embeds the Phase 7 reader for the pinned doc — **stubbed** because Phase 7 is absent (Task 9). ✔
- §8.4 Tests — unit: audit-feed scoping/pagination (`buildAuditFilters`/`clampPage`, Task 3) + embed URL validation rejecting unsafe schemes (Task 2); integration: Activity returns only visible events + a new mutation appears (Task 5); e2e: open Activity, edit in another tab, see it, add an Embed with a URL (Task 11). ✔
- §8.5 acceptance — covered in DoD + Task 11. ✔
- Deferral 4 (Doc/Chat depend on Phase 7) — Doc shipped as a feature-flagged stub (`DOCS_FEATURE_ENABLED=false`), verified absent during grounding. ✔

**Placeholder scan:** No "validate the other schemes similarly" / "etc." shortcuts. The Embed validator enumerates the allow-list + tests every rejected scheme; the Activity resolver, repo, service, and all three renderers are full code. The only intentional non-code is the documented `TODO(phase7)` inside the Doc renderer's flag-ON branch (unreachable today; spec-mandated stub) and the e2e helper-name adaptation note.

**Type/name consistency:** View-type tokens are exactly `activity`/`embed`/`doc` (the 9d-expanded `ViewType` union — asserted, not redefined, in Task 1). `AuditLogEntry`/`AuditLogPage` reused verbatim from `packages/types/index.ts` (~lines 723–743) and mapped identically to `admin.repository.mapEntry`. `usp_AuditLog_List` parameter names/types match the on-disk SP (`WorkspaceId`/`UserId`/`Resource`/`Action`/`ResourceId`/`FromDate`/`ToDate`/`Page`/`PageSize`, `TotalCount` window column). Realtime reuses the existing `TASK_EVENTS` operation + `task:event`/`notification:added` `useSubscription` patterns (NotificationBell/useLiveTasks/calendar-view). Authz mirrors `views.schema.ts` (`assertScopeType`, `authzNode`, `requireObjectLevel`, `requireEverythingWorkspace`). `config` shapes (`EmbedViewConfig.url`, `DocViewConfig.docId`) extend `ViewConfig` so `SavedView.config` stays one type. No REST routes invented — views are GraphQL-only (confirmed in `server/queries/views.ts`).
