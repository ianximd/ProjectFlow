-- =============================================================================
-- Migration 0061: Public Share Links + Access Requests (Phase 10c)
--   * ShareLinks — a scoped, read-only token granting access to EXACTLY one
--     object (task|doc|dashboard|view|whiteboard) at VIEW level. Token is a
--     high-entropy random string (NOT a GUID), UNIQUE for index-driven,
--     scan-free resolution. ExpiresAt/RevokedAt nullable.
--   * AccessRequests — an authed non-member's request for access to a private
--     object; resolved by an owner/admin who grants via the 10b editor.
--   * Seeds share.create / share.revoke permission slugs (owner + admin).
-- (Plan numbered this 0053; renumbered to 0061 — on-disk tip was 0060.)
-- Idempotent (catalog guards), GO-batched.
-- Rollback in rollback/0061_share_links.down.sql.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ShareLinks')
BEGIN
    CREATE TABLE dbo.ShareLinks (
        Id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_ShareLinks PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_ShareLinks_Workspace REFERENCES dbo.Workspaces(Id),
        ObjectType  NVARCHAR(16) NOT NULL,
        ObjectId    UNIQUEIDENTIFIER NOT NULL,
        Token       NVARCHAR(64) NOT NULL,
        Level       NVARCHAR(8)  NOT NULL CONSTRAINT DF_ShareLinks_Level DEFAULT 'VIEW',
        ExpiresAt   DATETIME2    NULL,
        CreatedBy   UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_ShareLinks_CreatedBy REFERENCES dbo.Users(Id),
        CreatedAt   DATETIME2    NOT NULL CONSTRAINT DF_ShareLinks_CreatedAt DEFAULT SYSUTCDATETIME(),
        RevokedAt   DATETIME2    NULL,
        CONSTRAINT CK_ShareLinks_ObjectType CHECK (ObjectType IN ('task','doc','dashboard','view','whiteboard')),
        CONSTRAINT CK_ShareLinks_Level      CHECK (Level IN ('VIEW','COMMENT','EDIT','FULL'))
    );
END
GO

-- The Token is the lookup key for the unauthenticated resolver — UNIQUE so the
-- SP resolves by an indexed equality (no scan, no per-byte secret comparison).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_ShareLinks_Token' AND object_id = OBJECT_ID('dbo.ShareLinks'))
    CREATE UNIQUE NONCLUSTERED INDEX UQ_ShareLinks_Token ON dbo.ShareLinks (Token);
GO

-- List-for-object lookup (sharing modal) — only live links.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ShareLinks_Object' AND object_id = OBJECT_ID('dbo.ShareLinks'))
    CREATE NONCLUSTERED INDEX IX_ShareLinks_Object ON dbo.ShareLinks (ObjectType, ObjectId) WHERE RevokedAt IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AccessRequests')
BEGIN
    CREATE TABLE dbo.AccessRequests (
        Id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_AccessRequests PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_AccessRequests_Workspace REFERENCES dbo.Workspaces(Id),
        ObjectType  NVARCHAR(16) NOT NULL,
        ObjectId    UNIQUEIDENTIFIER NOT NULL,
        RequestedBy UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_AccessRequests_RequestedBy REFERENCES dbo.Users(Id),
        Note        NVARCHAR(500) NULL,
        Status      NVARCHAR(12) NOT NULL CONSTRAINT DF_AccessRequests_Status DEFAULT 'pending',
        ResolvedBy  UNIQUEIDENTIFIER NULL
            CONSTRAINT FK_AccessRequests_ResolvedBy REFERENCES dbo.Users(Id),
        ResolvedAt  DATETIME2 NULL,
        CreatedAt   DATETIME2 NOT NULL CONSTRAINT DF_AccessRequests_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_AccessRequests_Status CHECK (Status IN ('pending','granted','denied'))
    );
END
GO

-- One pending request per (requester, object) — usp_AccessRequest_Create keys
-- off this so a repeat request returns the existing pending row.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_AccessRequests_Pending' AND object_id = OBJECT_ID('dbo.AccessRequests'))
    CREATE UNIQUE NONCLUSTERED INDEX UQ_AccessRequests_Pending
        ON dbo.AccessRequests (ObjectType, ObjectId, RequestedBy) WHERE Status = 'pending';
GO

-- ── Permission slugs (Phase 10c) ─────────────────────────────────────────────
-- Holding the slug is the coarse gate; the decisive check is FULL on the object
-- (accessService.can) applied in the route/service.
;WITH SeedPermissions(Resource, Action, Slug, Scope, Description) AS (
    SELECT * FROM (VALUES
        ('share', 'create', 'share.create', 'WORKSPACE', 'Create a public share link for an object'),
        ('share', 'revoke', 'share.revoke', 'WORKSPACE', 'Revoke a public share link')
    ) AS T(Resource, Action, Slug, Scope, Description)
)
INSERT INTO dbo.Permissions (Resource, Action, Slug, Scope, Description)
SELECT s.Resource, s.Action, s.Slug, s.Scope, s.Description
FROM SeedPermissions s
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permissions p WHERE p.Slug = s.Slug);
GO

;WITH RolePermSeed(RoleSlug, PermissionSlug) AS (
    SELECT * FROM (VALUES
        ('workspace-owner', 'share.create'), ('workspace-owner', 'share.revoke'),
        ('workspace-admin', 'share.create'), ('workspace-admin', 'share.revoke')
    ) AS T(RoleSlug, PermissionSlug)
)
INSERT INTO dbo.RolePermissions (RoleId, PermissionId)
SELECT r.Id, p.Id
FROM RolePermSeed s
JOIN dbo.Roles       r ON r.Slug = s.RoleSlug AND r.WorkspaceId IS NULL
JOIN dbo.Permissions p ON p.Slug = s.PermissionSlug
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.RolePermissions rp WHERE rp.RoleId = r.Id AND rp.PermissionId = p.Id
);
GO
