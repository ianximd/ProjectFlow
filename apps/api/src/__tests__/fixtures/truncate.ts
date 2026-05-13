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
  'CommentReactions',
  'Comments',
  'Attachments',
  'WorkLogs',
  'Notifications',
  'AuditLog',
  'GitPullRequests',
  'GitCommits',
  'OutgoingWebhookDeliveries',
  'AutomationRunHistory',
  'MfaRecoveryCodes',
  'RefreshTokens',
  'PasswordResetTokens',
  // UserRoles is per-user assignment — wipe. Roles + RolePermissions are
  // catalog seed and stay.
  'UserRoles',
  'WorkspaceMembers',
  // Mid-level
  'Tasks',
  'Sprints',
  'Versions',
  'Components',
  'Labels',
  'WorkflowTransitions',
  'WorkflowStatuses',
  'WorkflowDefinitions',
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
