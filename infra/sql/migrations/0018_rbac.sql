-- =============================================================================
-- Migration 0018: Role-based access control (RBAC)
-- =============================================================================
-- Adds four tables to support custom roles with action-level permissions:
--   * Permissions       — catalog of resource.action slugs
--   * Roles             — system or workspace scoped roles
--   * RolePermissions   — many-to-many: which permissions each role grants
--   * UserRoles         — many-to-many: which roles each user holds
--                         (WorkspaceId is NULL for system roles)
--
-- Seeds:
--   * ~50 permissions (10 SYSTEM, 40 WORKSPACE)
--   * 7 built-in roles (3 system, 4 workspace) marked IsSystem=1
--   * Role-permission mappings for each built-in
--
-- Backfill:
--   * Every existing WorkspaceMembers row → UserRoles entry mapping the
--     legacy free-text Role column to one of the seeded workspace roles.
--
-- Auto-promotion of users from the legacy ADMIN_USER_IDS env var happens
-- at API server startup (separate code), not in this migration.
-- =============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- Permissions
-- ────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.tables
    WHERE name = 'Permissions' AND schema_id = SCHEMA_ID('dbo')
)
CREATE TABLE dbo.Permissions (
    Id          UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
    Resource    NVARCHAR(64)  NOT NULL,
    Action      NVARCHAR(64)  NOT NULL,
    Slug        NVARCHAR(128) NOT NULL UNIQUE,         -- e.g. "task.update"
    Scope       NVARCHAR(16)  NOT NULL,                -- 'SYSTEM' | 'WORKSPACE'
    Description NVARCHAR(500) NULL,
    CreatedAt   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_Permissions_Scope CHECK (Scope IN ('SYSTEM','WORKSPACE'))
);
GO


-- ────────────────────────────────────────────────────────────────────────────
-- Roles
-- ────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.tables
    WHERE name = 'Roles' AND schema_id = SCHEMA_ID('dbo')
)
CREATE TABLE dbo.Roles (
    Id          UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
    Name        NVARCHAR(100) NOT NULL,
    Slug        NVARCHAR(100) NOT NULL UNIQUE,         -- e.g. "workspace-admin"
    Description NVARCHAR(500) NULL,
    Scope       NVARCHAR(16)  NOT NULL,                -- 'SYSTEM' | 'WORKSPACE'
    IsSystem    BIT           NOT NULL DEFAULT 0,      -- built-in roles can't be deleted
    CreatedAt   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_Roles_Scope CHECK (Scope IN ('SYSTEM','WORKSPACE'))
);
GO


-- ────────────────────────────────────────────────────────────────────────────
-- RolePermissions (many-to-many)
-- ────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.tables
    WHERE name = 'RolePermissions' AND schema_id = SCHEMA_ID('dbo')
)
CREATE TABLE dbo.RolePermissions (
    RoleId       UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Roles(Id) ON DELETE CASCADE,
    PermissionId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Permissions(Id) ON DELETE CASCADE,
    GrantedAt    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_RolePermissions PRIMARY KEY (RoleId, PermissionId)
);
GO


-- ────────────────────────────────────────────────────────────────────────────
-- UserRoles (many-to-many; WorkspaceId NULL for system roles)
--
-- WorkspaceKey is a PERSISTED computed column so we can include it in the
-- composite PK (SQL Server disallows NULL in PK columns; ISNULL maps NULL
-- workspace to the all-zero GUID for uniqueness purposes).
-- ────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.tables
    WHERE name = 'UserRoles' AND schema_id = SCHEMA_ID('dbo')
)
CREATE TABLE dbo.UserRoles (
    UserId       UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Users(Id),
    RoleId       UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Roles(Id),
    WorkspaceId  UNIQUEIDENTIFIER NULL     REFERENCES dbo.Workspaces(Id),
    AssignedBy   UNIQUEIDENTIFIER NULL     REFERENCES dbo.Users(Id),
    AssignedAt   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    WorkspaceKey AS ISNULL(WorkspaceId, CAST('00000000-0000-0000-0000-000000000000' AS UNIQUEIDENTIFIER)) PERSISTED,
    CONSTRAINT PK_UserRoles PRIMARY KEY (UserId, RoleId, WorkspaceKey)
);
GO


-- ────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_UserRoles_RoleId' AND object_id = OBJECT_ID('dbo.UserRoles'))
  CREATE NONCLUSTERED INDEX IX_UserRoles_RoleId ON dbo.UserRoles (RoleId) INCLUDE (UserId, WorkspaceId);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_UserRoles_WorkspaceId' AND object_id = OBJECT_ID('dbo.UserRoles'))
  CREATE NONCLUSTERED INDEX IX_UserRoles_WorkspaceId ON dbo.UserRoles (WorkspaceId) INCLUDE (UserId, RoleId)
    WHERE WorkspaceId IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RolePermissions_PermissionId' AND object_id = OBJECT_ID('dbo.RolePermissions'))
  CREATE NONCLUSTERED INDEX IX_RolePermissions_PermissionId ON dbo.RolePermissions (PermissionId) INCLUDE (RoleId);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Permissions_Scope' AND object_id = OBJECT_ID('dbo.Permissions'))
  CREATE NONCLUSTERED INDEX IX_Permissions_Scope ON dbo.Permissions (Scope) INCLUDE (Slug);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Roles_Scope' AND object_id = OBJECT_ID('dbo.Roles'))
  CREATE NONCLUSTERED INDEX IX_Roles_Scope ON dbo.Roles (Scope) INCLUDE (Slug, IsSystem);
GO


-- ────────────────────────────────────────────────────────────────────────────
-- Seed: Permissions
-- ────────────────────────────────────────────────────────────────────────────
;WITH SeedPermissions(Resource, Action, Slug, Scope, Description) AS (
    SELECT * FROM (VALUES
        -- ── SYSTEM permissions ──────────────────────────────────────────────
        ('admin',    'access',           'admin.access',             'SYSTEM',    'Access the admin area'),
        ('admin',    'stats.read',       'admin.stats.read',         'SYSTEM',    'View platform statistics'),
        ('admin',    'users.read',       'admin.users.read',         'SYSTEM',    'List and inspect all users'),
        ('admin',    'users.suspend',    'admin.users.suspend',      'SYSTEM',    'Suspend or restore a user account'),
        ('admin',    'workspaces.read',  'admin.workspaces.read',    'SYSTEM',    'List all workspaces'),
        ('admin',    'workspaces.delete','admin.workspaces.delete',  'SYSTEM',    'Delete any workspace'),
        ('admin',    'audit.read',       'admin.audit.read',         'SYSTEM',    'View the audit log'),
        ('admin',    'roles.manage',     'admin.roles.manage',       'SYSTEM',    'Create, edit, delete roles and assignments'),
        ('system',   'settings.write',   'system.settings.write',    'SYSTEM',    'Modify system-wide settings'),

        -- ── WORKSPACE permissions ───────────────────────────────────────────
        ('workspace','read',                'workspace.read',                  'WORKSPACE', 'View workspace details'),
        ('workspace','update',              'workspace.update',                'WORKSPACE', 'Edit workspace settings'),
        ('workspace','delete',              'workspace.delete',                'WORKSPACE', 'Delete the workspace'),
        ('workspace','members.read',        'workspace.members.read',          'WORKSPACE', 'View workspace members'),
        ('workspace','members.invite',      'workspace.members.invite',        'WORKSPACE', 'Invite new members'),
        ('workspace','members.remove',      'workspace.members.remove',        'WORKSPACE', 'Remove members'),
        ('workspace','members.assign_role', 'workspace.members.assign_role',   'WORKSPACE', 'Change a member''s role'),

        ('task',     'read',                'task.read',                       'WORKSPACE', 'View tasks'),
        ('task',     'create',              'task.create',                     'WORKSPACE', 'Create tasks'),
        ('task',     'update',              'task.update',                     'WORKSPACE', 'Edit tasks'),
        ('task',     'delete',              'task.delete',                     'WORKSPACE', 'Delete tasks'),
        ('task',     'assign',              'task.assign',                     'WORKSPACE', 'Assign tasks to users'),
        ('task',     'transition',          'task.transition',                 'WORKSPACE', 'Move a task through workflow states'),

        ('comment',  'create',              'comment.create',                  'WORKSPACE', 'Add comments'),
        ('comment',  'update.own',          'comment.update.own',              'WORKSPACE', 'Edit own comments'),
        ('comment',  'delete.own',          'comment.delete.own',              'WORKSPACE', 'Delete own comments'),
        ('comment',  'delete.any',          'comment.delete.any',              'WORKSPACE', 'Delete any comment'),

        ('attachment','create',             'attachment.create',               'WORKSPACE', 'Upload attachments'),
        ('attachment','delete.own',         'attachment.delete.own',           'WORKSPACE', 'Delete own attachments'),
        ('attachment','delete.any',         'attachment.delete.any',           'WORKSPACE', 'Delete any attachment'),

        ('worklog',  'create',              'worklog.create',                  'WORKSPACE', 'Log work on tasks'),
        ('worklog',  'update.own',          'worklog.update.own',              'WORKSPACE', 'Edit own worklog entries'),
        ('worklog',  'delete.own',          'worklog.delete.own',              'WORKSPACE', 'Delete own worklog entries'),
        ('worklog',  'delete.any',          'worklog.delete.any',              'WORKSPACE', 'Delete any worklog entry'),

        ('epic',     'read',                'epic.read',                       'WORKSPACE', 'View epics'),
        ('epic',     'create',              'epic.create',                     'WORKSPACE', 'Create epics'),
        ('epic',     'update',              'epic.update',                     'WORKSPACE', 'Edit epics'),
        ('epic',     'delete',              'epic.delete',                     'WORKSPACE', 'Delete epics'),

        ('version',  'read',                'version.read',                    'WORKSPACE', 'View versions'),
        ('version',  'create',              'version.create',                  'WORKSPACE', 'Create versions'),
        ('version',  'update',              'version.update',                  'WORKSPACE', 'Edit versions'),
        ('version',  'delete',              'version.delete',                  'WORKSPACE', 'Delete versions'),

        ('label',    'manage',              'label.manage',                    'WORKSPACE', 'Create, edit, delete labels'),
        ('component','manage',              'component.manage',                'WORKSPACE', 'Create, edit, delete components'),

        ('workflow', 'read',                'workflow.read',                   'WORKSPACE', 'View workflows'),
        ('workflow', 'update',              'workflow.update',                 'WORKSPACE', 'Edit workflows and transitions'),

        ('automation','read',               'automation.read',                 'WORKSPACE', 'View automation rules'),
        ('automation','create',             'automation.create',               'WORKSPACE', 'Create automation rules'),
        ('automation','update',             'automation.update',               'WORKSPACE', 'Edit automation rules'),
        ('automation','delete',             'automation.delete',               'WORKSPACE', 'Delete automation rules'),

        ('report',   'read',                'report.read',                     'WORKSPACE', 'View reports and dashboards'),

        ('git',      'integration.manage',  'git.integration.manage',          'WORKSPACE', 'Configure git provider integration'),
        ('webhook',  'manage',              'webhook.manage',                  'WORKSPACE', 'Configure outgoing webhooks')
    ) AS T(Resource, Action, Slug, Scope, Description)
)
INSERT INTO dbo.Permissions (Resource, Action, Slug, Scope, Description)
SELECT s.Resource, s.Action, s.Slug, s.Scope, s.Description
FROM SeedPermissions s
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permissions p WHERE p.Slug = s.Slug);
GO


-- ────────────────────────────────────────────────────────────────────────────
-- Seed: Roles (built-in)
-- ────────────────────────────────────────────────────────────────────────────
;WITH SeedRoles(Slug, Name, Scope, Description) AS (
    SELECT * FROM (VALUES
        ('super-admin',       'Super Admin',       'SYSTEM',    'Full access to every admin capability across the platform.'),
        ('user-admin',        'User Admin',        'SYSTEM',    'Manage user accounts and view audit log; cannot delete workspaces or change roles.'),
        ('auditor',           'Auditor',           'SYSTEM',    'Read-only access to audit log and platform statistics.'),
        ('workspace-owner',   'Workspace Owner',   'WORKSPACE', 'Full control over a workspace, including deletion and role assignment.'),
        ('workspace-admin',   'Workspace Admin',   'WORKSPACE', 'Manage workspace content, members and integrations; cannot delete the workspace.'),
        ('workspace-member',  'Workspace Member',  'WORKSPACE', 'Standard member: full read, can create and edit tasks/comments/worklogs.'),
        ('workspace-viewer',  'Workspace Viewer',  'WORKSPACE', 'Read-only access to workspace content.')
    ) AS T(Slug, Name, Scope, Description)
)
INSERT INTO dbo.Roles (Slug, Name, Scope, Description, IsSystem)
SELECT s.Slug, s.Name, s.Scope, s.Description, 1
FROM SeedRoles s
WHERE NOT EXISTS (SELECT 1 FROM dbo.Roles r WHERE r.Slug = s.Slug);
GO


-- ────────────────────────────────────────────────────────────────────────────
-- Seed: RolePermissions (built-in role → permission mappings)
-- ────────────────────────────────────────────────────────────────────────────
;WITH RolePermSeed(RoleSlug, PermissionSlug) AS (
    SELECT * FROM (VALUES
        -- super-admin: every SYSTEM permission
        ('super-admin', 'admin.access'),
        ('super-admin', 'admin.stats.read'),
        ('super-admin', 'admin.users.read'),
        ('super-admin', 'admin.users.suspend'),
        ('super-admin', 'admin.workspaces.read'),
        ('super-admin', 'admin.workspaces.delete'),
        ('super-admin', 'admin.audit.read'),
        ('super-admin', 'admin.roles.manage'),
        ('super-admin', 'system.settings.write'),

        -- user-admin: user mgmt + audit, no workspace deletion or role mgmt
        ('user-admin',  'admin.access'),
        ('user-admin',  'admin.users.read'),
        ('user-admin',  'admin.users.suspend'),
        ('user-admin',  'admin.audit.read'),

        -- auditor: read-only telemetry
        ('auditor',     'admin.access'),
        ('auditor',     'admin.audit.read'),
        ('auditor',     'admin.stats.read'),

        -- workspace-owner: every WORKSPACE permission
        ('workspace-owner', 'workspace.read'),
        ('workspace-owner', 'workspace.update'),
        ('workspace-owner', 'workspace.delete'),
        ('workspace-owner', 'workspace.members.read'),
        ('workspace-owner', 'workspace.members.invite'),
        ('workspace-owner', 'workspace.members.remove'),
        ('workspace-owner', 'workspace.members.assign_role'),
        ('workspace-owner', 'task.read'),
        ('workspace-owner', 'task.create'),
        ('workspace-owner', 'task.update'),
        ('workspace-owner', 'task.delete'),
        ('workspace-owner', 'task.assign'),
        ('workspace-owner', 'task.transition'),
        ('workspace-owner', 'comment.create'),
        ('workspace-owner', 'comment.update.own'),
        ('workspace-owner', 'comment.delete.own'),
        ('workspace-owner', 'comment.delete.any'),
        ('workspace-owner', 'attachment.create'),
        ('workspace-owner', 'attachment.delete.own'),
        ('workspace-owner', 'attachment.delete.any'),
        ('workspace-owner', 'worklog.create'),
        ('workspace-owner', 'worklog.update.own'),
        ('workspace-owner', 'worklog.delete.own'),
        ('workspace-owner', 'worklog.delete.any'),
        ('workspace-owner', 'epic.read'),
        ('workspace-owner', 'epic.create'),
        ('workspace-owner', 'epic.update'),
        ('workspace-owner', 'epic.delete'),
        ('workspace-owner', 'version.read'),
        ('workspace-owner', 'version.create'),
        ('workspace-owner', 'version.update'),
        ('workspace-owner', 'version.delete'),
        ('workspace-owner', 'label.manage'),
        ('workspace-owner', 'component.manage'),
        ('workspace-owner', 'workflow.read'),
        ('workspace-owner', 'workflow.update'),
        ('workspace-owner', 'automation.read'),
        ('workspace-owner', 'automation.create'),
        ('workspace-owner', 'automation.update'),
        ('workspace-owner', 'automation.delete'),
        ('workspace-owner', 'report.read'),
        ('workspace-owner', 'git.integration.manage'),
        ('workspace-owner', 'webhook.manage'),

        -- workspace-admin: same as owner minus delete and assign_role
        ('workspace-admin', 'workspace.read'),
        ('workspace-admin', 'workspace.update'),
        ('workspace-admin', 'workspace.members.read'),
        ('workspace-admin', 'workspace.members.invite'),
        ('workspace-admin', 'workspace.members.remove'),
        ('workspace-admin', 'task.read'),
        ('workspace-admin', 'task.create'),
        ('workspace-admin', 'task.update'),
        ('workspace-admin', 'task.delete'),
        ('workspace-admin', 'task.assign'),
        ('workspace-admin', 'task.transition'),
        ('workspace-admin', 'comment.create'),
        ('workspace-admin', 'comment.update.own'),
        ('workspace-admin', 'comment.delete.own'),
        ('workspace-admin', 'comment.delete.any'),
        ('workspace-admin', 'attachment.create'),
        ('workspace-admin', 'attachment.delete.own'),
        ('workspace-admin', 'attachment.delete.any'),
        ('workspace-admin', 'worklog.create'),
        ('workspace-admin', 'worklog.update.own'),
        ('workspace-admin', 'worklog.delete.own'),
        ('workspace-admin', 'worklog.delete.any'),
        ('workspace-admin', 'epic.read'),
        ('workspace-admin', 'epic.create'),
        ('workspace-admin', 'epic.update'),
        ('workspace-admin', 'epic.delete'),
        ('workspace-admin', 'version.read'),
        ('workspace-admin', 'version.create'),
        ('workspace-admin', 'version.update'),
        ('workspace-admin', 'version.delete'),
        ('workspace-admin', 'label.manage'),
        ('workspace-admin', 'component.manage'),
        ('workspace-admin', 'workflow.read'),
        ('workspace-admin', 'workflow.update'),
        ('workspace-admin', 'automation.read'),
        ('workspace-admin', 'automation.create'),
        ('workspace-admin', 'automation.update'),
        ('workspace-admin', 'automation.delete'),
        ('workspace-admin', 'report.read'),
        ('workspace-admin', 'git.integration.manage'),
        ('workspace-admin', 'webhook.manage'),

        -- workspace-member: read everything, write tasks/comments/worklogs
        ('workspace-member', 'workspace.read'),
        ('workspace-member', 'workspace.members.read'),
        ('workspace-member', 'task.read'),
        ('workspace-member', 'task.create'),
        ('workspace-member', 'task.update'),
        ('workspace-member', 'task.assign'),
        ('workspace-member', 'task.transition'),
        ('workspace-member', 'comment.create'),
        ('workspace-member', 'comment.update.own'),
        ('workspace-member', 'comment.delete.own'),
        ('workspace-member', 'attachment.create'),
        ('workspace-member', 'attachment.delete.own'),
        ('workspace-member', 'worklog.create'),
        ('workspace-member', 'worklog.update.own'),
        ('workspace-member', 'worklog.delete.own'),
        ('workspace-member', 'epic.read'),
        ('workspace-member', 'version.read'),
        ('workspace-member', 'workflow.read'),
        ('workspace-member', 'automation.read'),
        ('workspace-member', 'report.read'),

        -- workspace-viewer: read-only
        ('workspace-viewer', 'workspace.read'),
        ('workspace-viewer', 'workspace.members.read'),
        ('workspace-viewer', 'task.read'),
        ('workspace-viewer', 'epic.read'),
        ('workspace-viewer', 'version.read'),
        ('workspace-viewer', 'workflow.read'),
        ('workspace-viewer', 'report.read')
    ) AS T(RoleSlug, PermissionSlug)
)
INSERT INTO dbo.RolePermissions (RoleId, PermissionId)
SELECT r.Id, p.Id
FROM RolePermSeed s
JOIN dbo.Roles       r ON r.Slug = s.RoleSlug
JOIN dbo.Permissions p ON p.Slug = s.PermissionSlug
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.RolePermissions rp
    WHERE rp.RoleId = r.Id AND rp.PermissionId = p.Id
);
GO


-- ────────────────────────────────────────────────────────────────────────────
-- Backfill: existing WorkspaceMembers.Role → UserRoles
--
-- Mapping:
--   'OWNER'   → workspace-owner
--   'ADMIN'   → workspace-admin
--   'MEMBER'  → workspace-member
--   'VIEWER'  → workspace-viewer
--   anything else → workspace-member (logged via audit_log if available)
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO dbo.UserRoles (UserId, RoleId, WorkspaceId, AssignedBy, AssignedAt)
SELECT
    wm.UserId,
    r.Id           AS RoleId,
    wm.WorkspaceId,
    NULL           AS AssignedBy,
    SYSUTCDATETIME()
FROM dbo.WorkspaceMembers wm
JOIN dbo.Roles r
    ON r.Slug = CASE UPPER(LTRIM(RTRIM(wm.Role)))
                    WHEN 'OWNER'  THEN 'workspace-owner'
                    WHEN 'ADMIN'  THEN 'workspace-admin'
                    WHEN 'MEMBER' THEN 'workspace-member'
                    WHEN 'VIEWER' THEN 'workspace-viewer'
                    ELSE 'workspace-member'
                END
WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.UserRoles ur
    WHERE ur.UserId = wm.UserId
      AND ur.RoleId = r.Id
      AND ur.WorkspaceId = wm.WorkspaceId
);
GO
