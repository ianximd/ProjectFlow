# PR Review: #1 — Phase 3: Views Engine (savable/shareable List·Board·Table·Calendar + query compiler)

**Reviewed**: 2026-06-05
**Author**: ianximd
**Branch**: feat/views-engine-phase3 → main
**Scope**: 49 files, +7570 / −2 (net ~5159)
**Decision**: REQUEST CHANGES

## Summary
Strong, well-documented implementation. The query compiler's injection-safety is genuinely solid (allow-listed identifiers, every value bound, mandatory tenant + soft-delete + scope predicate always injected). Read/preview/CRUD GraphQL paths carry object-level authz and tenant isolation is tested. **One verified privilege-escalation in the bulk-edit path blocks merge**, plus a React correctness bug and several MEDIUM cleanups.

## Findings

### CRITICAL
None. (The compiler is injection-safe; tenant isolation holds via the always-injected `t.WorkspaceId = @ws` predicate + bound params.)

### HIGH

**H1 — Bulk-edit bypasses task permission slugs (privilege escalation). VERIFIED.**
`view.service.ts:184-187` gates every bulk action on `isWorkspaceMember(workspaceId, userId)` only. The equivalent single-task REST routes gate on granular slugs: `requirePermission('task.delete' | 'task.update' | 'task.transition' | 'task.assign')` (task.routes.ts). `isWorkspaceMember` is strictly weaker — the `workspace-viewer` role (0018_rbac.sql:368-375) grants membership but holds **zero** task-mutation slugs. So a read-only viewer is denied `DELETE /tasks/:id` yet can delete/transition/reassign/re-prioritize tasks through `bulkUpdateTasks`. The GraphQL resolver (views.schema.ts:267) adds no permission check beyond `requireUser`.
- Affected actions: `set_status`, `set_priority`, `set_assignees`, `delete`.
- `set_custom_field` / `move_to_list` are OK — they layer an object-level `accessService.can(...,'EDIT')` check that mirrors their single-task routes.
- **Fix**: in `applyAction`, after the membership gate, assert the matching permission slug per action (e.g. `task.delete` for delete, `task.transition` for set_status, `task.update` for set_priority, `task.assign` for set_assignees) using the same permission resolver the REST routes use. Add an integration test per action with a viewer-role user expecting failure.

**H2 — `filter-builder.tsx:359-364`: ref mutated during render.**
`NestedGroupEditor` reads and mutates `nestedKeysRef.current` (grow + slice) in the render body (5 `react-hooks/refs` ESLint errors). React may render without committing (Strict Mode / concurrent), so the key array can desync from the rules array → stale/duplicate React keys → broken reconciliation of nested filter rows.
- **Fix**: derive keys from rule identity, or seed once via `useState` and only mutate the key list in add/remove handlers, never during render.

### MEDIUM

**M1 — `IsDefault` clear has no `OwnerId` filter.** `usp_View_Create.sql:19-24` and `usp_View_Update.sql:18-23` clear `IsDefault` for all views matching WorkspaceId+ScopeType+ScopeId+Type — including views owned by *other* users (and private ones they can't see). User A making a default stomps user B's personal default for that scope/type. Decide the intended semantic; if "default" is per-user, add `AND OwnerId = @OwnerId` to both clear steps.

**M2 — Unguarded `JSON.parse(v.config)` in SSR.** `server/queries/views.ts:69` parses each view's config inside a `cache()`-wrapped server function with no try/catch. A malformed/empty `config` string throws a `SyntaxError` → full-page 500. **Fix**: try/parse with a safe default config fallback.

**M3 — `revalidatePath` omits the `/views` route.** `server/actions/views.ts:24-26` revalidates `/board` and `/lists/[listId]` after create/update/delete/reorder/bulk, but not `/views/[scopeType]/[scopeId]` — the surface that actually renders saved views. Other clients serve a stale view list/tab row. **Fix**: add `revalidatePath('/views', 'layout')` (or the specific segment).

**M4 — No upper bound on `pageSize`.** `repository.queryTasks` validates `pageSize` is an integer ≥ 1 but has no max; `previewViewTasks` feeds `config.pageSize` straight from client-supplied JSON (`runConfig` → `config.pageSize`). A caller can request an arbitrarily large page (heavy query / memory). **Fix**: clamp `pageSize` to a sane max (e.g. 200).

**M5 — `usp_View_Update` race + missing self-defense.** The existence check (lines 12-14) runs outside the transaction and the final `UPDATE ... WHERE Id = @Id` (line 31) lacks `DeletedAt IS NULL`, so a concurrent soft-delete between check and update would mutate a tombstoned row. Low probability, easy fix: add `AND DeletedAt IS NULL` (and, for defense-in-depth, `AND WorkspaceId = @Ws`) to the final UPDATE.

**M6 — `setState` in effect + unstable deps (list/table/calendar views).** `setSelected` is called directly in effects on `tasks` change (extra render), and `taskPage?.tasks ?? []` / `?? []` create new array refs each render that drive `useEffect`/`useMemo` deps. ESLint: `react-hooks/set-state-in-effect` (3), `exhaustive-deps` (3 warnings). **Fix**: derive selection via `useMemo`; memoize `tasks`/`groups`.

### LOW
- `server/queries/views.ts:110,160` raw tasks typed `any[]`; `board-view-engine.tsx:286` double `as unknown` cast — both silence real shape checks. Define a `RawTask` interface.
- All `usp_View_*` SPs use `SELECT *` — fragile output contract; confirm `mapSavedViewRow` does not surface `DeletedAt`.
- `filter-builder.tsx:355` silently drops nested sub-groups when flattening (UI data loss if a multi-level config is ever persisted).
- `calendar-view.tsx:237` uses array index as week `key`; `:98` `prefer-const` nit.
- Server actions pass client `scopeType/scopeId/config` without server-side scope authz (defense-in-depth) — acceptable because the GraphQL layer enforces `requireObjectLevel`, but no second line of defense.

### Verified NON-issues (raised during review, dismissed)
- **BIT NULL coercion in `usp_View_Update`** — `COALESCE(@IsShared, IsShared)` with the driver passing real `null` keeps existing values; this exact pattern ships in merged Phase 2 and is covered by the 121 passing integration tests (incl. view-crud).
- **Bulk cross-tenant** — the per-task membership gate + compiler's mandatory `WorkspaceId` predicate prevent cross-workspace access. (The H1 gap is *intra*-workspace permission level, not tenant.)
- **SQL injection in compiler/repository** — identifiers come only from the allow-list catalog; every value is bound; `customSortJoins` bind the FieldId GUID as `@<alias>_fid`; `groupExpr` is an allow-listed `t.<Column>` token; LIKE metachars escaped. Solid.
- **Date/hydration** — prior locale hydration bug stays fixed (`lib/date.ts` pins `en-US`); calendar `mounted` guard + date-only string handling avoid UTC-shift and SSR mismatch.

## Validation Results
| Check | Result |
|---|---|
| Type check | Pass — per PR (apps/api + apps/next-web typecheck clean); not re-run |
| Lint (next-web) | **Fail** — 13 errors / 11 warnings (react-hooks/refs x5, set-state-in-effect x3, no-explicit-any x2, prefer-const, exhaustive-deps warnings) |
| Unit tests | Pass — 219/219 per PR; not re-run |
| Integration tests | Pass — 121/121 per PR; not re-run |
| E2E (Playwright) | Deferred — written, live run pending deployed-DB e2e env (documented) |

## Files Reviewed (in full)
Backend: `query/{compiler,field-catalog,builtin-fields,types}.ts`, `view.repository.ts`, `view.service.ts`, `graphql/views.schema.ts`; all 7 `usp_View_*.sql` + `0032_saved_views.sql`. Frontend: views `page.tsx`, `seed-board-view.ts`, `view-surface/view-tabs/list/table/calendar/board-view-engine/filter-builder/bulk-bar`, `field-options.ts`, `server/queries/views.ts`, `server/actions/views.ts`, `lib/date.ts`. Cross-checked: `task.routes.ts`, `membership.ts`, `permissions.middleware.ts`, `0018_rbac.sql`.

## Recommended merge gate
Block on **H1** (security) and **H2** (correctness). M1–M4 strongly recommended in the same PR. LOW + ESLint cleanup can be a fast follow-up but the failing lint should at least be triaged.
