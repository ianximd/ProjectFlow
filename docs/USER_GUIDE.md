# ProjectFlow — User Guide

A practical guide to using ProjectFlow for day-to-day work. Page-by-page tour
plus the common flows you'll repeat dozens of times a week.

> For setup / self-hosting see the top-level [README](../README.md).
> For ops procedures see [docs/runbooks](./runbooks).

---

## 1. Concepts in 60 seconds

| Term | What it is |
|---|---|
| **Workspace** | Top-level container. Holds projects and members. You can belong to several. |
| **Project** | A product / team / initiative. Lives inside a workspace. Has its own backlog, board, workflow, sprints, etc. |
| **Issue / Task** | The unit of work. Can be `EPIC`, `STORY`, `TASK`, `BUG`, `SUBTASK`, `IMPROVEMENT`, `FEATURE`, or `TEST`. Has a status, priority, and optional sprint/epic/dates. |
| **Workflow** | The columns on your board (e.g. *To Do → In Progress → Done*). Each project has one default workflow that you can customise. |
| **Status category** | An abstract bucket every status maps to: `IDEA`, `TODO`, `IN_PROGRESS`, `TESTING`, `DONE`. Drives the column accent colour and roll-up reports. |
| **Sprint** | A timeboxed iteration. Contains a subset of the backlog. |
| **Issue key** | Stable short code like `PF-123` (project key + serial). Search-friendly. |

---

## 2. First time signing in

1. Open the app at `http://localhost:3000` (or your hosted URL).
2. **Register** if you don't have an account, or **Log in** with email + password.
   - **MFA**: if enabled, you'll be asked for a code after the password step.
   - **OAuth**: if your admin has wired Google / GitHub, the buttons appear on
     the login page. (See *Settings → Connected accounts* later to link/unlink.)
3. If your account has no workspace yet, you'll be taken to **`/setup`** to
   create one. Pick a name and slug — you become the owner.
4. After setup you land on **Board**. The active workspace + project is shown
   in the header; switch via the dropdowns there.

---

## 3. Navigation

The sidebar groups pages into four sections:

| Group | Pages |
|---|---|
| **Workspace** | Board · Backlog · Roadmap · Dashboard · Notifications |
| **Plan** | Epics · Versions |
| **Configure** | Workflows · Automations · Labels · Git |
| **System** | Workspaces · Projects · Admin · GraphQL |

The header shows the **active workspace + project** with switchers next to
each. The avatar in the top-right opens *Settings*, *Sign out*, etc.

---

## 4. Board (`/board`)

The kanban view of the active project. One column per workflow status.

- **Drag a card** between columns to change its status. Position within a
  column is preserved across reloads.
- **Add a card** — click *+ Add* under any column header.
- **Open a card** — click the card body to open the *Task Drawer* (right-side
  pane with full details and editors).
- **Filter bar**: search by title or issue key, filter by **Type** or
  **Priority**. Active filter count shown as a badge; *Clear* resets all three.
- **Column accent** matches the status's category colour:

  | Category | Colour |
  |---|---|
  | IDEA | amber |
  | TODO | grey |
  | IN_PROGRESS | blue |
  | TESTING | orange |
  | DONE | green |

> Newly created projects ship with a 5-column default workflow:
> **Ideas → To Do → In Progress → Testing → Done**. Existing projects keep
> whatever workflow you configured — see *Workflows* to customise.

---

## 5. Backlog (`/backlog`)

A flat list grouped by sprint, with the un-sprinted backlog at the bottom.

- **Section header**: collapse/expand, total points roll-up, *+ Add issue*.
- **Inline create**: type a title in the row that appears, press Enter to
  save. Only the title is required; you can fill the rest in the drawer.
- **Row anatomy** (left → right): type chip · issue key · title · assignees ·
  story points · status chip · **priority dot** · delete (on hover).
- **Change priority inline**: click the small priority dot at the right edge
  of any row. A dropdown lists *Highest / High / Medium / Low / Lowest* with
  colour swatches; the current value is bold. Pick to save.
- **Open drawer**: click anywhere on the row.
- **Delete**: hover the row, click the trash icon. Confirmation prompt.

---

## 6. The Task Drawer

Opened from anywhere a task is rendered (Board, Backlog, Roadmap, Dashboard).

| Section | Editable | Notes |
|---|---|---|
| **Header** | — | Issue key + close button. |
| **Type / Status / Priority chips** | Priority is editable | Pick a new priority from the inline `<select>`; auto-saves, no Save button. The colour updates to match. |
| **Schedule** | Yes | Set or clear *Start date* (day-granular) and *Due date* (with time). One *Save schedule* button persists both at once. |
| **Description** | Read-only here | Edit via the API or backlog inline editor (coming). |
| **Attachments** | Upload / delete | S3 / MinIO–backed; signed download URLs valid for 15 min. |
| **Time Tracking** | Add / edit / delete work logs | Per-user totals roll up into reports. |
| **Pull Requests & Commits** | View | Auto-linked when commit messages or branch names mention the issue key (requires Git integration). |
| **Comments** | Yes | Rich text (TipTap), `@mentions` (notifies), emoji reactions, threading. |

> **Tip** — pressing *Esc* closes the drawer.

---

## 7. Roadmap (`/roadmap`)

Gantt-style timeline of all tasks with start/due dates in the active project.

- Drag a bar's edge to resize (changes start or due date).
- Drag the body to slide both dates without changing duration.
- Tasks without dates are listed below the timeline; assign dates to surface
  them.
- Epic rows can be expanded to show their child issues inline.

---

## 8. Dashboard (`/dashboard`)

Reporting view, scoped to the active project.

| Tile | What it shows |
|---|---|
| **Burndown** | Remaining points per day across the selected sprint, against the ideal line. |
| **Sprint summary** | Issue counts and points (committed vs. completed) for the selected sprint, plus a status breakdown. |
| **Velocity** | Last 6 sprints — committed vs completed points side by side. |
| **Team workload** | Open issues + open points per assignee. |
| **Created vs Resolved** | Weekly counts so you can spot a growing backlog. |

The *Sprint* selector at the top of the burndown / summary tiles drives both.

---

## 9. Notifications (`/notifications`)

In-app feed of:

- @mentions in comments
- Issue assignments
- Status transitions on issues you watch
- System messages (workspace status changes, etc.)

The bell badge in the top bar reflects the unread count. Click an entry to
jump to the source (e.g. open the relevant task drawer).

---

## 10. Plan

### Epics (`/epics`)

List of EPIC-type issues with progress bars (children completed / total). Open
an epic to see its children grouped by status. Use this as a high-level
view of multi-issue initiatives.

### Versions (`/versions`)

Releases. Each version has a status (`UNRELEASED`, `RELEASED`, `ARCHIVED`),
optional dates, and a count of issues tagged with it. Mark a version
released when it ships — analytics and roadmap reflect the change.

---

## 11. Configure

### Workflows (`/workflows`)

Edit the project's status list and transitions.

- **Statuses card**: each row is a status. Click to edit name, **category**,
  and colour. Drag to reorder.
- **Categories** drive board accent colour and report roll-ups. Available:
  *Idea*, *To Do*, *In Progress*, *Testing*, *Done*.
- **Transitions card**: pick a *From → To* pair; optionally name the
  transition (shown in the audit log). The status-transition validator on
  the API enforces these — drag-and-drop on the board bypasses them
  intentionally.

> **Adding IDEA / TESTING to an existing project**: open this page, click
> *+ Add status*, set the category, and save. The board will gain the
> column on next load.

### Automations (`/automations`)

Trigger → Condition → Action rules. Built on BullMQ, evaluated server-side.

- **Triggers**: `ISSUE_CREATED`, `ISSUE_UPDATED`, `ISSUE_TRANSITIONED`,
  `SPRINT_STARTED`, `SPRINT_COMPLETED`, `DUE_DATE_APPROACHING`,
  `SCHEDULED` (cron), `MANUAL`, `WEBHOOK`.
- **Conditions** can filter by field equality, PQL expression, sprint
  membership, or user role.
- **Actions**: transition the issue, (un)assign, set priority, add a
  comment, send a notification, fire a webhook.
- Toggle the *Enabled* switch to pause without deleting. Execution count and
  last-run timestamp are shown per rule.

### Labels (`/project-settings`)

Project-scoped tags with colours. Apply via the API today; UI exposes the
catalogue and counts.

### Git (`/project-settings?tab=git`)

Per-workspace GitHub / GitLab connection. Once authorised, PRs and commits
that mention an issue key (e.g. `PF-123`) auto-link into the task drawer's
*Pull Requests & Commits* section. Webhook secret is stored encrypted.

---

## 12. System

### Workspaces (`/workspaces`)

List the workspaces you're a member of. Click one to switch the active
workspace globally. Owners can rename, change avatar, and (eventually)
archive.

### Projects (`/projects`)

All projects in the active workspace. Filter, archive, or open settings per
project.

### Admin (`/admin`)

Available only to users with `admin.*` permissions.

| Tab | What you can do |
|---|---|
| **Overview** | System totals — users, workspaces, projects, tasks, logins (24h), audit events today. |
| **Users** | Search, paginate, **create**, edit, suspend / restore, **reset password**, disable MFA, unlock failed-login lockout, delete. Bulk select for suspend/restore. **Roles** button (per row) opens the new dialog where you can assign or revoke any role for that user. |
| **Workspaces** | List with member / project counts. Flip the *Status* enum (`ACTIVE`, `TRIAL`, `FROZEN`, `SUSPENDED`) per row. |
| **Audit Log** | Filter by resource, action, and date range. Expand any row to see the *Before / After* JSON diff. |
| **Roles & Permissions** | Browse system + workspace roles. Built-ins are read-only for name/scope; custom roles are fully editable. Click a role to open its editor: name, description, permission set, and the new **Members** panel (assign / revoke users; for workspace-scoped roles you also pick the workspace). |

### GraphQL (`/graphql-explorer`)

Interactive GraphQL playground over the same data — useful for ad-hoc
queries that the REST surface doesn't directly expose.

---

## 13. Settings

Open via the avatar dropdown in the top bar.

- **Profile** — name, avatar, email change (re-verifies on change).
- **Password** — change current password.
- **MFA** — enable / disable TOTP. Pairs with any authenticator app.
- **Connected accounts** (`/settings/connected-accounts`) — link or unlink
  Google / GitHub for OAuth sign-in.

---

## 14. Common flows

### Plan a sprint

1. Backlog → click *+ Add issue* in the sprint section to populate it (or
   drag from the *Backlog* section once the dnd is enabled for cross-section).
2. Each issue: open the drawer, set *Story points* (via API today) and
   priority (inline drawer select).
3. From the dashboard, watch *Velocity* to size sprints to past throughput.
4. Sprint *Start* / *Complete* lives on the sprint admin endpoint; the
   start triggers the `SPRINT_STARTED` automation event, completion the
   `SPRINT_COMPLETED` event.

### Take an issue from idea to done

1. Add an issue to the *Ideas* column (or backlog) — auto-categorised `IDEA`.
2. Promote to *To Do* when committed.
3. Drag to *In Progress* when work starts; assign yourself if not already.
4. Push to *Testing* when ready for QA.
5. *Pass* moves it to *Done*; *Fail* sends it back to *In Progress*.

### Find an issue fast

- Backlog or Board: type into the *Search* input — matches title or
  `IssueKey`.
- For complex filters use **PQL** in the search dialogs (e.g.
  `priority = HIGHEST AND status != Done AND assignee = me()`).

### Give a teammate admin powers

1. Admin → Users → click *Roles* on their row.
2. In the dialog, pick `super-admin` (system-scoped) or `workspace-admin`
   (workspace-scoped, then choose the workspace).
3. *Assign*. Their next request will see the new permissions immediately.

To revoke, the same dialog lists their assignments with a *Revoke* button.
The system refuses to revoke the *last* super-admin to prevent lockout.

### Hand a project a custom workflow column

1. Workflows → *+ Add status* — name it, pick a *Category* (e.g. `TESTING`),
   pick a colour.
2. Add transitions to / from the new status if you want the validator to
   enforce them.
3. Reload the board — the column appears with the category accent.

---

## 15. Tips & gotchas

- **Drag-and-drop bypasses the workflow validator** — moving a card to any
  column always works, even when no transition is defined. This is
  intentional: typing a transition is for forms / API; the board is for
  fast triage. Audit log still records it.
- **Priority dropdown vs. select** — backlog rows use a `DropdownMenu`
  (click the dot); the task drawer uses a native `<select>` next to the
  status chip. Both call the same `PATCH /tasks/:id` endpoint.
- **Workspace status** — if your workspace is `FROZEN` or `SUSPENDED`, write
  operations are rejected with a `WORKSPACE_FROZEN` toast. Read works fine.
- **Token lifetime** — JWTs are 15 minutes; the client refreshes silently.
  If a request 401s right at the boundary, re-try; the next attempt picks up
  the refreshed token from the store.
- **Issue-key links in commits** — write `PF-123` in your commit message or
  branch name and the GitHub/GitLab webhook will attach the commit / PR to
  that issue. Multiple keys per commit are supported.
- **Esc / click-outside** closes drawers and dialogs everywhere.

---

## 16. Where to look when something breaks

| Symptom | Where to look |
|---|---|
| 401 in the browser | Token expired — refresh page. If it persists, you were signed out (e.g. password reset). |
| 403 on a write | Permission missing for that workspace. Ask an admin to grant the appropriate role via *Admin → Users → Roles*. |
| 409 *WORKSPACE_FROZEN* | Workspace is frozen / suspended; contact an admin to set it back to *Active*. |
| Board column shows `col-undefined` | Was a long-standing case-drift bug, fixed in May 2026. If you still see it, hard-refresh to pick up the fix. |
| Notifications never arrive | Check WebSocket connection in devtools → Network → WS. The fallback REST poll is every 60s. |
| Auto-save doesn't persist | Look for the small red note next to the field. Check api logs for the matching `WARN` request id. |

---

*Last updated: May 2026 — v1.0.0.*
