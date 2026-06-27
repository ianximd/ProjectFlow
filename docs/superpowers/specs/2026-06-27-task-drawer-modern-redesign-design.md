# Task Drawer — Modern Redesign (Design Spec)

**Date:** 2026-06-27
**Branch:** feat/task-drawer-restyle
**Status:** Approved — ready for implementation planning
**Scope:** Visual/UX redesign of the task detail drawer. All existing features retained.

---

## 1. Goal & Non-Goals

**Goal:** Overhaul the task drawer into a modern, two-column, tabbed module — the kind of
issue-detail experience found in Linear/Jira — while keeping every existing feature and the
existing data/mutation logic intact.

**Non-goals:**
- No architectural rewrite of the 1,349-line `TaskDrawer.tsx` logic. Data loading, optimistic
  mutations, presence, and subscriptions are preserved as-is.
- No new task features beyond surfacing the existing `activityFeed` in an Activity tab.
- No new task-mutation APIs. The Activity tab reuses the existing `activityFeed` query and audit
  data; it requires only a **small scope-resolution change** (see §3a) to accept a `TASK` scope —
  no new endpoints, no change to how tasks are mutated.

> **Review correction (2026-06-27):** an earlier draft claimed the Activity tab needed *no*
> backend change. That was verified false — `getScopeNode` (SQL proc `usp_CustomField_GetScopeNode`)
> supports only `SPACE`/`FOLDER`/`LIST`, so a `TASK` scope currently throws `NOT_FOUND`
> (`activity.service.ts:74`). The required change is captured in §3a. Decision: **include it in v1.**

---

## 2. Current State (baseline)

- **`apps/next-web/src/components/TaskDrawer.tsx`** — a ~1,349-line monolith. Custom drawer
  (its own overlay + `TaskDrawer.module.css`, **not** the shared `ui/Sheet` primitive). Holds
  ~18 sections in a flat top-to-bottom scroll, width 720px.
- **Half-migrated styling:** the outer `TaskDrawer.module.css` was recently moved to Ocean Blue
  theme tokens (commit b857d7f), but the body still contains many inline hardcoded dark hex
  values (`#2d3748`, `#4a5568`, `#1a202c`, `#e2e8f0`, …), and several sub-section CSS modules
  remain on a hardcoded dark palette: `CommentSection.module.css`, `AttachmentSection.module.css`,
  `WorkLogSection.module.css`, `pull-requests.module.css`.
- **Existing sub-components** (reused unchanged): `CommentSection`, `AttachmentSection`,
  `WorkLogSection`, `TaskEstimateBar`, `PullRequestsSection`, `tasks/dependencies-section`,
  `tasks/recurrence-editor`, `TaskTypeSelector`, `TagPicker`, `WatcherControl`,
  `custom-fields/CustomFieldCell`, `custom-fields/RelationshipField`, `templates/SaveAsTemplateModal`,
  `sharing/ShareModal`.

---

## 3. Approach

**Restructure in place with minimal extraction.** `TaskDrawer.tsx` remains the orchestrator and
keeps all the hard parts (data loading, optimistic mutations with rollback, presence, Apollo
subscriptions). It gains a new layout shell: a full-width header, a title block, then a two-column
body (main + sidebar) with a tabbed main column.

- Existing sub-components are **reused unchanged** — relocated into tab/sidebar slots.
- The only genuinely new file is **`ActivityTab`** (reuses the `activityFeed` query).
- Rationale: re-house working JSX and theme it; do not rewrite working logic. Lowest-risk path to
  a coherent modern result.

Light extraction is acceptable where it makes the new layout maintainable (e.g. a layout shell,
tab bar, sidebar, and per-tab panel render functions/components), but full state-prop extraction
of every section is explicitly out of scope.

**Tab panels stay as in-file render functions** within `TaskDrawer.tsx` (not separate components),
so the drawer's large local-state surface — title/description/priority/status/assignees/dates
mirrors, `useTransition` states, picker state — is not threaded through props. The only new
**file** is `ActivityTab` (it owns its own fetch + state and takes just `taskId` + `workspaceId`).

---

## 3a. Backend Change — Task-Scoped Activity (required for the Activity tab)

Enabling `activityFeed(scopeType: "TASK", scopeId: <taskId>, workspaceId: <wsId>)`:

1. **SQL proc** `usp_CustomField_GetScopeNode` — add a `TASK` branch returning the task's
   `WorkspaceId` (+ path) from `dbo.Tasks WHERE Id = @ScopeId AND DeletedAt IS NULL`. Ship as a new
   migration.
2. **GraphQL validation** (`apps/api/src/graphql/activity.schema.ts`) — add `TASK` to the accepted
   scope-type set.
3. **Service cast** (`apps/api/src/modules/activity/activity.service.ts:70`) — widen the
   `'LIST' | 'FOLDER' | 'SPACE'` cast to include `'TASK'`.
4. **Type union** (`packages/types`) — add `'TASK'` to the custom-field scope-type union.

The filter layer already works: `buildAuditFilters` forwards `scopeId` as `resourceId`, and task
UPDATE audit rows store `resourceId = taskId` (`audit.middleware.ts:144`). No further query change.

The frontend **must pass `workspaceId`** (the drawer already receives it as a prop) so the scope
node resolves.

---

## 4. Layout & Placement

```
+--------------------------------------------------------------+
| breadcrumb · TASK-123  🔁     [presence]   share template ⤢ x |
|--------------------------------------------------------------|
| Big editable title (full width)                              |
|------------------------------------+-------------------------|
| [Details] Comments  Files  Activity|  Status      [Todo  v]  |
|------------------------------------|  Priority    [High  v]  |
| ## Description (markdown edit)     |  Type     ◆ Milestone   |
| Dependencies (waiting on/blocking) |  Points        [5]      |
| Recurrence                         |  Assignees  (AB)(CD) +  |
| Custom fields                      |  Start / Due  Jun 27    |
| Pull requests                      |  Tags     #api #ui +    |
| Time tracking (full WorkLogSection)|  Watchers      (2)      |
|  (scrolls)                         |  Time  ▓▓▓░ 2h / 4h ⏱   |
+------------------------------------+-------------------------+
```

### Header (full width)
Breadcrumb (Space / Folder / List, read-only) + issue key + recurrence badge (🔁 when active);
presence bar (viewer avatars + typing indicator); action buttons — Share, Save-as-template,
**Expand⤢**, Close.

### Title block (full width, under header)
Large click-to-edit title (borderless, grows with content; Escape reverts, Enter commits).

### Main column — sticky tab bar + scrollable panel
- **Details** (default tab): Description (markdown view/edit) → Dependencies (waiting on / blocking)
  → Recurrence → Custom fields (scalar + relationship + rollup) → Pull requests → **Time tracking
  (full `WorkLogSection`)**. Each is a clean sub-section with a small muted uppercase header.
- **Comments**: `CommentSection` (live Apollo subscription, mentions, reactions).
- **Files**: `AttachmentSection` (drag-drop upload, download, delete).
- **Activity**: new — `activityFeed` scoped to the task id (see §3a), grouped by day. Diff
  formatting is **bounded**: render `field: old → new` for known task fields (status, priority,
  title, dates, assignees, …); fall back to a compact raw-JSON line for unrecognized
  `oldValues`/`newValues` keys. No attempt to prettify every possible audit shape.

### Sidebar (~300px, scrollable property rows)
Status, Priority, Type (+ milestone marker ◆), Story points (**read-only badge** — editing is out
of scope), Assignees (chips + picker), Start/Due dates (+ clear), Tags, Watchers, and
**Time tracking summary** (estimate bar + actual
rollup + start/stop timer + "Log time" button). The Time tracking block — both the sidebar summary
and the Details-tab `WorkLogSection` — is hidden when the `time_tracking` app is OFF for the scope.

### Time-tracking split (confirmed)
The **sidebar** shows the time summary + timer + "Log time" button. The **full `WorkLogSection`**
(entry form, range entry, billable toggle, tag picker, entries list) lives as the last section of
the **Details tab**, since it is too wide for a 300px rail. This is the only feature split across
the layout. (Confirmed with user.)

---

## 5. Visual Language & Theming

- **Full Ocean Blue theme-token migration.** Every remaining inline hardcoded hex in
  `TaskDrawer.tsx` and the still-dark sub-section CSS modules (`CommentSection.module.css`,
  `AttachmentSection.module.css`, `WorkLogSection.module.css`, `pull-requests.module.css`) move to
  `var(--…)` tokens (`--background`, `--foreground`, `--border`, `--secondary`,
  `--secondary-foreground`, `--muted-foreground`, `--accent`, `--ring`). No hardcoded hex remains
  in the drawer surface. Light + dark both correct.
- **Property rows:** consistent muted label + value control, consistent row height, hover affordance.
- **Sub-section headers:** small uppercase muted label, optional action on the right.
- **Tabs:** underline-style active indicator using `--accent` / `--ring`.
- **Radius/spacing:** consistent with the recent Sheet revamp.
- **Motion:** keep slide-in; tab switch = quick fade; expand = width transition. Respect
  `prefers-reduced-motion`.

---

## 6. States & Edge Cases

- **Expand⤢:** drawer transitions from ~960px (default) to near-full-screen; sidebar stays fixed
  width, main column grows. Toggle persists for the session (not across reloads, v1).
- **Responsive:** below ~900px the sidebar drops below the main column (single column); tabs
  unchanged.
- **Loading:** skeletons for lazy-loaded data (statuses, custom fields, members, activity feed).
- **Empty:** retain existing per-section empty hints ("Add description", etc.); add an Activity
  empty state.
- **Errors:** existing optimistic-update rollback + toast (`notifyActionError`) retained unchanged.
- **App gate:** time tracking (sidebar summary + Details-tab `WorkLogSection`) hidden when the
  `time_tracking` app is OFF.
- **Accessibility:** proper `role=tablist` / `tab` / `tabpanel` with arrow-key navigation; focus
  management on open/close/Escape; `aria-modal` retained; visible focus rings on all controls.
- **Activity v1 caveat:** the task *create* event does not appear (audit CREATE rows carry a null
  `resourceId`); all subsequent edits (which carry the taskId) do appear.

---

## 7. Testing

- **Backend:** integration test for `activityFeed` with `scopeType: "TASK"` — resolves the
  workspace node and returns the task's audit rows (extends `activity.integration.test.ts`, which
  currently only covers `EVERYTHING`).
- **Unit:** `ActivityTab` (render, day-grouping, bounded diff formatting + raw fallback), tab
  switching, expand toggle, responsive-collapse logic.
- **Reuse:** existing sub-component tests stay green (sub-components unchanged).
- **i18n:** add tab labels and Activity strings to `apps/next-web/messages/en.json` and `id.json`.
- **Manual/visual:** light + dark theme pass on every section; keyboard navigation; expand and
  responsive collapse.

---

## 8. Open Questions / Follow-ups (not blocking)

- Persisting the expand state across reloads (deferred; session-only in v1).
- Proper subtree-scoped activity (the audit log has no path column today; v1 shows task-id-exact
  rows only). Tracked as a backend follow-up, out of scope here.
