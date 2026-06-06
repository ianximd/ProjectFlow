# Phase 5d — Templates Implementation Plan

> Execute via subagent-driven-development. Reference design spec
> `docs/superpowers/specs/2026-06-06-phase5-deps-relationships-recurring-templates-design.md` §6.
> Follow patterns from 5a/5b/5c (DECISIONS.md). DB only on local Docker `ProjectFlow_Test`.

**Goal:** Save a **task / list / folder / space** as a reusable template (snapshot JSON) and **apply** it —
recreating the subtree with fresh IDs, **date remapping** from a chosen anchor, and an **"import selected
items"** subset option.

**Architecture:** One `Templates` table holding a JSON `Snapshot` per template (subtree + settings; every
date stored as a **day-offset from a reference anchor**). Capture composes existing reads; apply composes
existing create SPs (`usp_Project_Create`/`usp_Folder_Create`/`usp_List_Create`/`usp_Task_Create` + custom-field
create + `usp_View_Create`). Dual REST + GraphQL. ACL: capture needs VIEW on the source node; apply needs the
create permission at the target parent + EDIT on the target.

---

## Batch 1 — Backend: DB + capture + template CRUD
**Migration `0037_templates.sql`** (+ rollback):
```
Templates(
  Id PK DEFAULT NEWID(), WorkspaceId UNIQUEIDENTIFIER NOT NULL,
  ScopeType NVARCHAR(8) NOT NULL,   -- 'TASK'|'LIST'|'FOLDER'|'SPACE'
  Name NVARCHAR(255) NOT NULL, Description NVARCHAR(MAX) NULL,
  Snapshot NVARCHAR(MAX) NOT NULL,  -- JSON
  CreatedById UNIQUEIDENTIFIER NOT NULL,
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  DeletedAt DATETIME2 NULL,
  CONSTRAINT CK_Templates_Scope CHECK (ScopeType IN ('TASK','LIST','FOLDER','SPACE'))
)  -- index (WorkspaceId, ScopeType, DeletedAt)
```
**SPs:** `usp_Template_Create(@Id,@WorkspaceId,@ScopeType,@Name,@Description,@Snapshot,@CreatedById)`,
`usp_Template_List(@WorkspaceId,@ScopeType?)`, `usp_Template_GetById(@Id)`, `usp_Template_Delete(@Id)` (soft).

**Types** (`packages/types/index.ts`): `TemplateScopeType`, `Template`, and the `TemplateSnapshot` shape:
- TASK node: `{ title, description, type, priority, estimate, startOffset?:number|null, dueOffset?:number|null, customFieldValues:[{fieldId,value}], tags:[], subtasks:[<task node>...] }` (assignees DROPPED by default — user-specific, see deferral).
- LIST node: `{ name, workflow/statuses?, fieldDefs:[<custom field defn>], views:[<view config>], tasks:[<task node>...] }`.
- FOLDER node: `{ name, folders:[<folder node>...], lists:[<list node>...] }`.
- SPACE node: `{ name, settings, folders:[<folder node>...], lists:[<list node>...] }`.
- Each date stored as a **day-offset** from the template's reference anchor (the source node's "today"/min date). Pure `dateToOffset(date, anchor)` + `offsetToDate(offset, newAnchor)` helpers (unit-tested).

**Capture service** (`apps/api/src/modules/templates/template.service.captureXxx`): compose existing reads —
discover the node's subtree (folders/lists under a space; lists under a folder; tasks under a list; subtasks
recursively), each task's effective custom-field values (SKIP relationship/rollup/progress_auto — computed/linked,
not portable) + tags, the list's custom-field DEFINITIONS + saved views, the space/folder/list settings.
Investigate the exact read SPs/repos first (hierarchy tree read, `usp_View_List`, customfield reads, task list
read). Build the snapshot with date-offsets.

**API (CRUD):** REST `POST /templates` body `{ scopeType, sourceId, name, description? }` (capture; VIEW on
source) → `{ data: Template }`; `GET /templates?scopeType=`; `GET /templates/:id`; `DELETE /templates/:id`. +
GraphQL mirror. (Apply endpoint is Batch 2.)

**Verify Batch 1 (local Docker):** migrate + deploy SPs (0 failed); apps/api tsc clean; unit (+ offset helpers); integration (capture a LIST → snapshot has tasks/fieldDefs/views with offsets).

## Batch 2 — Backend: apply
**Apply service** `template.service.apply(templateId, { targetParentId, anchorDate, selectedItemIds? })`:
- Resolve the snapshot; recreate the subtree depth-first using the existing create SPs with FRESH ids and
  `Path` built from parent paths; remap each date via `offsetToDate(offset, anchorDate)`; create custom-field
  DEFINITIONS for lists, set task custom-field VALUES, recreate views (`usp_View_Create`).
- **import selected items:** when `selectedItemIds` is given, only recreate the snapshot nodes whose stable
  snapshot-node id is in the set (+ their required ancestors). Assign each snapshot node a stable index/id at
  capture time so the UI can select.
- ACL: require the create permission at `targetParentId` (`project.create` for SPACE under workspace;
  list/folder create perms for LIST/FOLDER under a space/folder) + EDIT on the target. Workspace-scope everything.
  Wrap in a transaction-like best-effort (log + report partial on failure; templates are additive).
- Publish task `created` events for recreated tasks.

**API:** REST `POST /templates/:id/apply` body `{ targetParentId, anchorDate, selectedItemIds? }` → the created
root node (+ summary counts). + GraphQL `applyTemplate`.

**Verify Batch 2:** integration — capture a LIST template → apply into a target space → asserts tasks + field
defs + views recreated with remapped dates; TASK apply; FOLDER + SPACE subtree apply; import-selected subset.

## Batch 3 — Frontend
- "Save as template" action on space / folder / list / task (in the sidebar tree context menu + the task drawer).
- Create-template modal (name/description). Apply / "Create from template" modal: pick a template, a target
  parent, an anchor date, and (optional) an item-selection tree. A basic **Template Center** page listing
  workspace templates by scope with apply/delete.
- Server actions hitting the REST template endpoints; i18n `Templates` namespace en/id (parity). No `export type`
  re-exports from `'use server'` files. Verify web unit + parity + tsc/build.

## Batch 4 — Tests + close
- e2e `templates.spec.ts`: seed a list with tasks (with due dates) + a saved view; save it as a template; apply
  it into a target; assert the recreated list has the tasks (and dates remapped). 
- Consolidated review → fixes → full verify (API unit+integration, web unit+parity, build, e2e) → `DECISIONS.md`
  §5d + memory → ff-merge to main locally → **push the whole Phase 5 to origin/main** (phase end).

## Acceptance (spec §6.6)
- [ ] Applying a list template recreates tasks, fields, views, and remaps dates.

## Carry-forward guards
- Workspace-scope all template SPs/queries; apply only within the caller's workspace.
- Recursive CTEs use `UNION ALL`; no `export type` re-exports from `'use server'`.
- SKIP relationship/rollup/progress_auto custom-field VALUES in capture (not portable); copy field DEFINITIONS.
- Assignees dropped from task templates by default (user-specific) — documented deferral.
