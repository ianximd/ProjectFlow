# Move Task to List — Design

**Date:** 2026-07-01
**Status:** Approved (design)
**Scope:** Turn the headless `moveTaskToList` action into a real feature: a user-facing entry point plus correct cross-list/cross-space move semantics.

## Problem

`moveTaskToList(taskId, listId, position)` (web action → `PATCH /tasks/:id/move` → `taskService.moveTask` → `usp_Task_Move`) already exists but has **no UI** and **incomplete semantics**:

- The stored proc re-homes the task (`ListId`, `ListPath`, `ProjectId` = destination space, `Position`) but **leaves `Status` and `SprintId` untouched**.
- Moving to a list with a *different workflow* can strand the task on a status that doesn't exist there (renders in an "unknown"/uncategorized column).
- Moving to a list in a *different space* leaves a **dangling `SprintId`** (sprints are space-scoped).
- Subtasks (`ParentTaskId`) are not cascaded, so a parent can end up in a different list than its children.

The automation "move task" action already calls `taskService.moveTask`, so fixing semantics at the service/proc layer benefits automation-driven moves too.

## Decisions (locked)

| Question | Decision |
| --- | --- |
| **Entry point** | The `TaskDrawer` breadcrumb's **List** segment becomes an actionable **Move** picker. (Drag-between-lists and row context-menu are possible later additions, out of scope here.) |
| **Status on cross-workflow move** | **Preserve if valid** in the destination workflow, else **remap to the destination's default** status. |
| **Sprint** | **Detach on cross-space move** (clear `SprintId`); keep the sprint when the move stays within the same space. |
| **Subtasks** | **Cascade** — subtasks (all descendants) follow the parent into the destination list, with the same status/sprint rules applied per row. |
| **Default status** | Lowest-position status in the open / "To Do" category; fallback = lowest-position status overall. |
| **Position** | Defaults to **append at bottom** of the destination list when not supplied. |

## Architecture

Approach **C — service-authoritative**. The service computes the decisions (reusing existing status resolution); the stored proc applies them atomically. The frontend stays thin. Every caller (drawer, automation, future drag/menu) inherits identical behavior.

```
TaskDrawer (breadcrumb "List ▾")
   └─ MoveTaskPicker ── moveTaskToList(taskId, listId)   [position omitted → append]
        └─ PATCH /tasks/:id/move   (gates EDIT on destination list — already exists)
             └─ taskService.moveTask(taskId, listId, position?)   ← becomes semantics-aware
                  ├─ load task (current status, source space = ProjectId, sprintId)
                  ├─ listService.effectiveStatuses(destList)  → validStatuses[] + defaultStatus
                  ├─ dest space vs source space               → clearSprint flag
                  └─ usp_Task_Move(@TaskId,@ListId,@Position,@ValidStatuses,@DefaultStatus,@ClearSprint)
                        └─ one transaction, set-based over task + all descendant subtasks
```

## Backend

### `taskService.moveTask(taskId, listId, position?)`

1. Load the task → `Status`, `ProjectId` (source space via the bridge), `SprintId`.
2. `listService.effectiveStatuses(listId)` → build:
   - `validStatuses`: pipe-joined list of destination workflow status names.
   - `defaultStatus`: lowest-position status in the open/"To Do" category; fallback lowest-position overall.
3. Resolve destination `spaceId` (small `getSpaceId(listId)` lookup) → `clearSprint = SprintId != null && sourceSpaceId !== destSpaceId`.
4. `position`: use the supplied value; when omitted, append to the bottom of the destination list.
5. Call the extended `usp_Task_Move` with the decided values.

### Extended `usp_Task_Move`

New params: `@ValidStatuses NVARCHAR(MAX)` (pipe-delimited), `@DefaultStatus NVARCHAR(100)`, `@ClearSprint BIT`. In **one transaction**:

1. Resolve destination `SpaceId` + `ListPath` from `Lists` (existing guard: `THROW` if list not found; `THROW` if task not found).
2. A **recursive CTE** over `ParentTaskId` collects the task **and all descendant subtasks**.
3. A single set-based `UPDATE dbo.Tasks` over that set:
   - `ListId` = `@ListId`, `ListPath` = destination path, `ProjectId` = destination `SpaceId`
   - `Position` = `@Position` **for the parent only** (`CASE WHEN Id = @TaskId THEN @Position ELSE Position END`) — subtasks keep their relative order
   - `Status` = `CASE WHEN Status IN (SELECT value FROM STRING_SPLIT(@ValidStatuses, '|')) THEN Status ELSE @DefaultStatus END`
   - `SprintId` = `CASE WHEN @ClearSprint = 1 THEN NULL ELSE SprintId END`
   - `UpdatedAt` = `SYSUTCDATETIME()`
4. Return the updated parent row (unchanged contract for callers).

The four rules fall out of a single UPDATE. The proc file lives at `infra/sql/procedures/usp_Task_Move.sql`.

### Route / caching

- `PATCH /tasks/:id/move` keeps its `requireObjectAccess('EDIT', destination LIST)` gate. `moveSchema.position` becomes optional.
- `invalidateTaskCaches(destProjectId)` + `publishTaskMove` already cover the re-homed subtree, since all descendants now share the destination project.

## Frontend

- **`TaskDrawer`**: the breadcrumb List segment becomes a `button` opening `MoveTaskPicker`.
- **Data (lazy):** add a `listWorkspaceLists()` server action returning `{ id, name, spaceId }[]` for the active workspace (flattened across spaces — same pattern as the docs create-task wiring). Fetched on first open of the picker, cached for the drawer session (mirrors the drawer's existing lazy members fetch).
- **Picker UI:** lists grouped by space; the task's **current list is disabled**. Selecting a list calls `moveTaskToList(task.id, listId)` (position omitted → append).
- **Cross-space warning:** each option carries `spaceId`; when a candidate list is in a different space than the task, its row shows an inline note — *"Moves out of its space: clears sprint, status may change."* No modal.
- **Result:** `useTransition` pending state; success → `toast.success` + `router.refresh()`; failure → `notifyActionError`. Same idioms as `DocPageTree`.

## Error handling & edge cases

- **No EDIT on destination** → route `403` → toast "You don't have access to that list."
- **Destination deleted / not found** → `404` → toast.
- **Same-list selection** → disabled in the picker; server treats it as a harmless reposition if it slips through.
- **Empty workspace lists** → picker shows "No other lists available."
- **Concurrent/stale** → server is authoritative; `router.refresh()` reconciles. No optimistic reordering to roll back.

## Testing

**Backend (integration, mirrors existing sprint-move tests):**
- Same-space move, status valid in dest → status + sprint preserved.
- Cross-space move, status absent in dest workflow → remapped to default; sprint cleared.
- Cross-space move, status present in dest → preserved; sprint cleared.
- Subtask cascade: parent + (nested) subtasks re-homed; per-row status preserve/remap; sprint cleared cross-space; subtasks keep relative order.
- EDIT gate: no access to destination → `403`, no mutation.
- Destination list not found → `404`.
- Regression: existing sprint-sweep / sprint-folders move tests still green (update expectations for the new status/sprint behavior).

**Frontend (React Testing Library):**
- Picker lists workspace lists, disables current list, renders cross-space warning only for other-space rows.
- Select → calls `moveTaskToList` with correct args; success toast + refresh; error path toasts.
- a11y: breadcrumb trigger is a `button`; menu has proper roles/labels.

## Out of scope

- Drag-a-task-between-sidebar-lists and row context-menu "Move to…" entry points (future additions; the service semantics already support them).
- Bulk / multi-select move.
- Moving across **workspaces** (the picker is workspace-scoped; the EDIT gate blocks it regardless).
