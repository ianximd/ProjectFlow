-- =============================================================================
-- Migration 0062: Guests & Limited Members (Phase 10d)
-- (Plan numbered this 0054; renumbered to 0062 — on-disk tip was 0061.)
-- External-access membership on top of the existing RBAC + object ACL:
--   * Permissions  — new WORKSPACE slugs guest.invite / guest.manage
--   * Roles        — two IsSystem=1 WORKSPACE roles (WorkspaceId NULL = system),
--                    minimal slug sets:
--                      workspace-guest          (external, non-org-email)
--                      workspace-limited-member (internal, org-email)
--                    Both have NO membership floor (enforced in
--                    usp_ObjectAccess_Resolve) — they see only explicitly
--                    granted objects. They differ ONLY in the service-layer
--                    invite/grant guards, not in resolution.
--   * GuestInvites — pending email+object+level invites with a unique token
--   * WorkspaceMembers.IsGuest — denormalized flag for fast tree-visibility
--                    filtering (authoritative role is still the UserRoles row)
--   * Workspaces.VerifiedDomain — lightweight org-email domain (greenfield;
--                    Workspaces had no domain column). NULL = no org-email rule.
-- Idempotent (catalog/NOT EXISTS guards), GO-batched.
-- Rollback in rollback/0062_guests.down.sql.
-- =============================================================================

-- ── New permission slugs ─────────────────────────────────────────────────────
;WITH SeedPermissions(Resource, Action, Slug, Scope, Description) AS (
    SELECT * FROM (VALUES
        ('guest', 'invite', 'guest.invite', 'WORKSPACE', 'Invite a guest to a specific object'),
        ('guest', 'manage', 'guest.manage', 'WORKSPACE', 'List and revoke workspace guests')
    ) AS T(Resource, Action, Slug, Scope, Description)
)
INSERT INTO dbo.Permissions (Resource, Action, Slug, Scope, Description)
SELECT s.Resource, s.Action, s.Slug, s.Scope, s.Description
FROM SeedPermissions s
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permissions p WHERE p.Slug = s.Slug);
GO

-- ── Two system roles (WorkspaceId NULL = system; UQ_Roles_Slug_System) ───────
;WITH SeedRoles(Slug, Name, Scope, Description) AS (
    SELECT * FROM (VALUES
        ('workspace-guest',          'Guest',          'WORKSPACE', 'External guest: no membership floor; sees only explicitly granted objects.'),
        ('workspace-limited-member', 'Limited Member', 'WORKSPACE', 'Internal limited member (org-email): no membership floor; sees only explicitly granted objects.')
    ) AS T(Slug, Name, Scope, Description)
)
INSERT INTO dbo.Roles (Slug, Name, Scope, Description, IsSystem)
SELECT s.Slug, s.Name, s.Scope, s.Description, 1
FROM SeedRoles s
WHERE NOT EXISTS (SELECT 1 FROM dbo.Roles r WHERE r.Slug = s.Slug AND r.WorkspaceId IS NULL);
GO

-- ── Minimal RolePermissions for both roles (join system roles only) ──────────
-- Both get only the read slugs needed to render an explicitly-granted object.
-- They hold NO workspace.read / members.read (they must NOT enumerate the tree
-- or the member list); object visibility comes entirely from ObjectPermissions
-- grants resolved with NO floor.
;WITH RolePermSeed(RoleSlug, PermissionSlug) AS (
    SELECT * FROM (VALUES
        ('workspace-guest',          'task.read'),
        ('workspace-guest',          'comment.create'),
        ('workspace-guest',          'comment.update.own'),
        ('workspace-guest',          'comment.delete.own'),
        ('workspace-limited-member', 'task.read'),
        ('workspace-limited-member', 'comment.create'),
        ('workspace-limited-member', 'comment.update.own'),
        ('workspace-limited-member', 'comment.delete.own')
    ) AS T(RoleSlug, PermissionSlug)
)
INSERT INTO dbo.RolePermissions (RoleId, PermissionId)
SELECT r.Id, p.Id
FROM RolePermSeed s
JOIN dbo.Roles       r ON r.Slug = s.RoleSlug AND r.WorkspaceId IS NULL
JOIN dbo.Permissions p ON p.Slug = s.PermissionSlug
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.RolePermissions rp
    WHERE rp.RoleId = r.Id AND rp.PermissionId = p.Id
);
GO

-- ── GuestInvites ─────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'GuestInvites')
BEGIN
    CREATE TABLE dbo.GuestInvites (
        Id          UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Workspaces(Id),
        Email       NVARCHAR(255)    NOT NULL,
        ObjectType  NVARCHAR(8)      NOT NULL,   -- 'SPACE'|'FOLDER'|'LIST' (SPACE rejected for guests at the service layer)
        ObjectId    UNIQUEIDENTIFIER NOT NULL,
        Level       NVARCHAR(8)      NOT NULL,   -- 'VIEW'|'COMMENT'|'EDIT'|'FULL'
        Token       NVARCHAR(64)     NOT NULL UNIQUE,
        Status      NVARCHAR(12)     NOT NULL CONSTRAINT DF_GuestInvites_Status DEFAULT 'pending',
        InvitedBy   UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Users(Id),
        ExpiresAt   DATETIME2        NULL,
        CreatedAt   DATETIME2        NOT NULL CONSTRAINT DF_GuestInvites_CreatedAt DEFAULT SYSUTCDATETIME(),
        AcceptedAt  DATETIME2        NULL,
        CONSTRAINT CK_GuestInvites_ObjectType CHECK (ObjectType IN ('SPACE','FOLDER','LIST')),
        CONSTRAINT CK_GuestInvites_Level      CHECK (Level IN ('VIEW','COMMENT','EDIT','FULL')),
        CONSTRAINT CK_GuestInvites_Status     CHECK (Status IN ('pending','accepted','revoked'))
    );
    CREATE NONCLUSTERED INDEX IX_GuestInvites_Workspace ON dbo.GuestInvites (WorkspaceId, Status);
    CREATE NONCLUSTERED INDEX IX_GuestInvites_Email     ON dbo.GuestInvites (Email);
END
GO

-- ── WorkspaceMembers.IsGuest (denormalized tree-visibility flag) ─────────────
IF COL_LENGTH('dbo.WorkspaceMembers', 'IsGuest') IS NULL
    ALTER TABLE dbo.WorkspaceMembers ADD IsGuest BIT NOT NULL CONSTRAINT DF_WorkspaceMembers_IsGuest DEFAULT 0;
GO

-- ── Workspaces.VerifiedDomain (lightweight org-email rule) ───────────────────
IF COL_LENGTH('dbo.Workspaces', 'VerifiedDomain') IS NULL
    ALTER TABLE dbo.Workspaces ADD VerifiedDomain NVARCHAR(255) NULL;
GO
