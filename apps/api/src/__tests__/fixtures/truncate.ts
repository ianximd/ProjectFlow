/**
 * truncateAll — clear every mutable table between integration tests.
 *
 * Iterates child → parent so foreign keys hold without disabling them.
 * Static catalog tables are preserved:
 *   - `Permissions` — seeded by migrations 0018 / 0019 / 0022 and queried
 *     on every permission check.
 *   - `Roles`       — the seven built-in roles seeded by migration 0018.
 *   - `RolePermissions` — the role→permission grants seeded by 0018+.
 * Wiping any of these would silently strip the workspace-owner role of
 * `workspace.delete` (and similar) so freshly-created workspaces would
 * 403 their own owners.
 *
 * Uses DELETE rather than TRUNCATE TABLE because TRUNCATE is forbidden on
 * tables referenced by FKs (which most of these are). DELETE is slower but
 * works without dropping/recreating constraints.
 */

import { getPool } from '../../shared/lib/db.js';

const TRUNCATION_ORDER = [
  // Children first (FK leaves)
  'TaskAssignees',
  'TaskDependencies',
  // Phase 5c (0036): TaskRecurrences FK Tasks — delete before Tasks or the
  // Tasks DELETE fails the FK once a recurrence row exists.
  'TaskRecurrences',
  // Phase 3 (0032): SavedViews — FK Workspaces/Users, delete before them.
  'SavedViews',
  // Phase 9a (0051): Dashboards — DashboardCards FK Dashboards (CASCADE);
  // Dashboards FK Workspaces + Users. Child→parent, both before Workspaces/Users
  // or the Workspaces/Users DELETE fails FK_Dashboards_* once a dashboard exists.
  'DashboardCards',
  'Dashboards',
  // Phase 9c (0054): ScheduledReports + ScheduledReportRuns — Runs FK Schedules
  // (ON DELETE CASCADE); Schedules reference Workspaces/Users/Dashboards by id
  // WITHOUT an FK (DashboardId is a plain column). Child→parent, both before
  // Workspaces/Users so their DELETE doesn't strand a schedule row.
  'ScheduledReportRuns',
  'ScheduledReports',
  // Phase 10a (0058): AppsEnabled — feature-toggle overrides; FK Workspaces(Id) +
  // Users(Id) (UpdatedBy). Workspace-scoped, so delete before Workspaces/Users or
  // their DELETE fails FK_AppsEnabled_* once a toggle override exists.
  'AppsEnabled',
  // Phase 8e (0049): Goals & Targets — Targets FK Goals; Goals FK GoalFolders +
  // Workspaces. Child→parent (Targets → Goals → GoalFolders), all before Workspaces/Users.
  'Targets',
  'Goals',
  'GoalFolders',
  // Phase 2 (0030) — value/watcher leaves, FK Tasks/CustomFields/Users.
  'TaskCustomFieldValues',
  'TaskWatchers',
  'CommentReactions',
  'Comments',
  'Attachments',
  // Phase 8a (0043): WorkLogTags FK WorkLogs/Tags — delete before WorkLogs.
  'WorkLogTags',
  'WorkLogs',
  // Phase 8b (0044): Timesheets FK Users (UserId + ReviewedById) — delete before
  // Users or the Users DELETE fails FK_Timesheets_User once an envelope exists.
  'Timesheets',
  'Notifications',
  'AuditLog',
  'GitPullRequests',
  'GitCommits',
  'OutgoingWebhookDeliveries',
  'AutomationRunHistory',
  // Phase 7a (0040): docs — child-first FK order
  'DocTaskLinks',
  'DocPageVersions',
  'DocPages',
  'Docs',
  // Phase 7b (0041): whiteboards — child-first FK order
  'WhiteboardTaskLinks',
  'Whiteboards',
  // Phase 7c (0042): forms — FormSubmissions FK Tasks/Forms/Users (delete before
  // Tasks/Users); Forms FK Lists/Workspaces/Users (delete before them).
  'FormSubmissions',
  'Forms',
  'MfaRecoveryCodes',
  'RefreshTokens',
  'PasswordResetTokens',
  // UserRoles is per-user assignment — wipe. Roles + RolePermissions are
  // catalog seed and stay.
  'UserRoles',
  'WorkspaceMembers',
  // Object-level ACL (0029) — FKs Workspaces/Users/Roles, delete before them.
  'ObjectPermissions',
  // Mid-level
  // Phase 8a (0043): TaskEstimates FK Tasks/Users — delete before Tasks.
  'TaskEstimates',
  'Tasks',
  // Phase 2 (0030): Tasks.TaskTypeId FKs TaskTypes — delete after Tasks.
  'TaskTypes',
  // Phase 8c (0046): SprintSettings FK Folders; Sprints now FK Lists/Folders
  // (0046 added Sprints.ListId/FolderId). Both MUST be deleted BEFORE Lists/Folders
  // or the Lists/Folders DELETE fails the new FK once a sprint row exists.
  'SprintSettings',
  'Sprints',
  // Hierarchy (0029): Tasks FK Lists; Lists FK Folders; both FK Projects/Workflows.
  'Lists',
  'Folders',
  'Versions',
  'Components',
  'Labels',
  // Phase 2 (0030): CustomFields FK Workspaces; its child TaskCustomFieldValues already wiped above.
  'CustomFields',
  'WorkflowTransitions',
  'WorkflowStatuses',
  'WorkflowDefinitions',
  // Workflows FK Projects (and Projects.WorkflowId FKs Workflows — the cycle is
  // broken by nulling Projects/Folders/Lists.WorkflowId in truncateAll first).
  'Workflows',
  'AutomationRules',
  'OutgoingWebhooks',
  'GitConnections',
  'IntegrationConfigs',
  // Top-level
  'Projects',
  'Workspaces',
  'Users',
] as const;

export async function truncateAll(): Promise<void> {
  const pool = await getPool();
  // Break the Projects⇄Workflows circular FK (and Folders/Lists→Workflows) so
  // both ends can be deleted. Guarded so it's a no-op before migration 0029 /
  // when a column is absent.
  for (const stmt of [
    "UPDATE dbo.Projects SET WorkflowId = NULL WHERE WorkflowId IS NOT NULL",
    "IF OBJECT_ID('dbo.Folders') IS NOT NULL UPDATE dbo.Folders SET WorkflowId = NULL WHERE WorkflowId IS NOT NULL",
    "IF OBJECT_ID('dbo.Lists') IS NOT NULL UPDATE dbo.Lists SET WorkflowId = NULL WHERE WorkflowId IS NOT NULL",
  ]) {
    try { await pool.request().query(stmt); } catch { /* column/table not present yet */ }
  }
  for (const table of TRUNCATION_ORDER) {
    try {
      await pool.request().query(`DELETE FROM dbo.[${table}]`);
    } catch (err: any) {
      // A missing table (e.g. a future migration not yet run, or a name
      // that's been renamed) shouldn't blow up the whole reset. Skip and
      // continue so the rest of the cleanup still happens.
      if (err?.number === 208) {
        // 208 = "Invalid object name" — table doesn't exist
        continue;
      }
      throw new Error(`truncateAll failed on ${table}: ${err?.message ?? err}`);
    }
  }
}

export const TRUNCATION_ORDER_REFERENCE = TRUNCATION_ORDER;
