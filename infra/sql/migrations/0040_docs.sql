-- =============================================================================
-- Migration 0040: Docs & Wikis (Phase 7a)
-- The first knowledge surface + the persistence backing of the new Yjs collab
-- channel. Four tables:
--   Docs            — a doc container, scoped to a hierarchy node (SPACE/FOLDER/LIST),
--                     wiki flag + verifier.
--   DocPages        — nested pages (ParentPageId tree, fractional Position),
--                     BodyYjs (live CRDT binary) + BodyJson (rendered ProseMirror
--                     JSON for SSR first-paint + search).
--   DocPageVersions — history snapshots (NVARCHAR(MAX) JSON) for restore.
--   DocTaskLinks    — doc<->task links ('reference' | 'embed').
-- Idempotent (catalog guards), GO-batched. Rollback in rollback/0040_docs.down.sql.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Docs')
BEGIN
    CREATE TABLE dbo.Docs (
        Id           UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId  UNIQUEIDENTIFIER NOT NULL,
        ScopeType    NVARCHAR(8)      NOT NULL,             -- 'SPACE' | 'FOLDER' | 'LIST'
        ScopeId      UNIQUEIDENTIFIER NOT NULL,
        Name         NVARCHAR(255)    NOT NULL,
        Icon         NVARCHAR(64)     NULL,
        IsWiki       BIT              NOT NULL CONSTRAINT DF_Docs_IsWiki DEFAULT 0,
        VerifiedById UNIQUEIDENTIFIER NULL,
        CreatedById  UNIQUEIDENTIFIER NOT NULL,
        CreatedAt    DATETIME2        NOT NULL CONSTRAINT DF_Docs_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt    DATETIME2        NOT NULL CONSTRAINT DF_Docs_UpdatedAt DEFAULT SYSUTCDATETIME(),
        DeletedAt    DATETIME2        NULL,
        CONSTRAINT CK_Docs_ScopeType CHECK (ScopeType IN ('SPACE','FOLDER','LIST')),
        CONSTRAINT FK_Docs_Workspace FOREIGN KEY (WorkspaceId) REFERENCES dbo.Workspaces(Id),
        CONSTRAINT FK_Docs_Creator   FOREIGN KEY (CreatedById) REFERENCES dbo.Users(Id),
        CONSTRAINT FK_Docs_Verifier  FOREIGN KEY (VerifiedById) REFERENCES dbo.Users(Id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Docs_Scope' AND object_id = OBJECT_ID('dbo.Docs'))
    CREATE NONCLUSTERED INDEX IX_Docs_Scope ON dbo.Docs (WorkspaceId, ScopeType, ScopeId) WHERE DeletedAt IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DocPages')
BEGIN
    CREATE TABLE dbo.DocPages (
        Id           UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        DocId        UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_DocPages_Doc REFERENCES dbo.Docs(Id) ON DELETE CASCADE,
        ParentPageId UNIQUEIDENTIFIER NULL
            CONSTRAINT FK_DocPages_Parent REFERENCES dbo.DocPages(Id),
        Title        NVARCHAR(255)    NOT NULL CONSTRAINT DF_DocPages_Title DEFAULT N'Untitled',
        Icon         NVARCHAR(64)     NULL,
        Cover        NVARCHAR(1024)   NULL,
        Position     FLOAT            NOT NULL CONSTRAINT DF_DocPages_Position DEFAULT 0,  -- fractional index
        BodyYjs      VARBINARY(MAX)   NULL,    -- live Yjs state
        BodyJson     NVARCHAR(MAX)    NULL,    -- rendered ProseMirror JSON (SSR + search)
        CreatedAt    DATETIME2        NOT NULL CONSTRAINT DF_DocPages_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt    DATETIME2        NOT NULL CONSTRAINT DF_DocPages_UpdatedAt DEFAULT SYSUTCDATETIME(),
        DeletedAt    DATETIME2        NULL
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DocPages_DocTree' AND object_id = OBJECT_ID('dbo.DocPages'))
    CREATE NONCLUSTERED INDEX IX_DocPages_DocTree ON dbo.DocPages (DocId, ParentPageId, Position) WHERE DeletedAt IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DocPageVersions')
BEGIN
    CREATE TABLE dbo.DocPageVersions (
        Id          UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        PageId      UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_DocPageVersions_Page REFERENCES dbo.DocPages(Id) ON DELETE CASCADE,
        Snapshot    NVARCHAR(MAX)    NOT NULL,   -- ProseMirror JSON at checkpoint time
        CreatedById UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_DocPageVersions_Creator REFERENCES dbo.Users(Id),
        CreatedAt   DATETIME2        NOT NULL CONSTRAINT DF_DocPageVersions_CreatedAt DEFAULT SYSUTCDATETIME()
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DocPageVersions_Page' AND object_id = OBJECT_ID('dbo.DocPageVersions'))
    CREATE NONCLUSTERED INDEX IX_DocPageVersions_Page ON dbo.DocPageVersions (PageId, CreatedAt DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DocTaskLinks')
BEGIN
    CREATE TABLE dbo.DocTaskLinks (
        Id        UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        DocPageId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_DocTaskLinks_Page REFERENCES dbo.DocPages(Id) ON DELETE CASCADE,
        TaskId    UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_DocTaskLinks_Task REFERENCES dbo.Tasks(Id) ON DELETE CASCADE,
        Kind      NVARCHAR(20)     NOT NULL CONSTRAINT DF_DocTaskLinks_Kind DEFAULT 'reference',
        CreatedAt DATETIME2        NOT NULL CONSTRAINT DF_DocTaskLinks_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_DocTaskLinks_Kind CHECK (Kind IN ('reference','embed'))
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DocTaskLinks_Page' AND object_id = OBJECT_ID('dbo.DocTaskLinks'))
    CREATE NONCLUSTERED INDEX IX_DocTaskLinks_Page ON dbo.DocTaskLinks (DocPageId);
GO

-- =============================================================================
-- Seed: doc.* RBAC permission slugs (idempotent — guarded by NOT EXISTS).
-- Mirrors the pattern in 0018_rbac.sql. Added here so 0040 is self-contained
-- and no new migration number is needed.
-- Grant matrix:
--   workspace-owner   : doc.create + doc.read + doc.update  (full authoring)
--   workspace-admin   : doc.create + doc.read + doc.update  (full authoring)
--   workspace-member  : doc.create + doc.read + doc.update  (standard member)
--   workspace-viewer  : doc.read only
-- =============================================================================
;WITH DocPerms(Resource, Action, Slug, Scope, Description) AS (
    SELECT * FROM (VALUES
        ('doc', 'create', 'doc.create', 'WORKSPACE', 'Create docs and wikis'),
        ('doc', 'read',   'doc.read',   'WORKSPACE', 'View docs and pages'),
        ('doc', 'update', 'doc.update', 'WORKSPACE', 'Edit docs, pages, versions and links')
    ) AS T(Resource, Action, Slug, Scope, Description)
)
INSERT INTO dbo.Permissions (Resource, Action, Slug, Scope, Description)
SELECT d.Resource, d.Action, d.Slug, d.Scope, d.Description
FROM DocPerms d
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permissions p WHERE p.Slug = d.Slug);
GO

;WITH DocRolePerms(RoleSlug, PermSlug) AS (
    SELECT * FROM (VALUES
        ('workspace-owner',  'doc.create'),
        ('workspace-owner',  'doc.read'),
        ('workspace-owner',  'doc.update'),
        ('workspace-admin',  'doc.create'),
        ('workspace-admin',  'doc.read'),
        ('workspace-admin',  'doc.update'),
        ('workspace-member', 'doc.create'),
        ('workspace-member', 'doc.read'),
        ('workspace-member', 'doc.update'),
        ('workspace-viewer', 'doc.read')
    ) AS T(RoleSlug, PermSlug)
)
INSERT INTO dbo.RolePermissions (RoleId, PermissionId)
SELECT r.Id, p.Id
FROM DocRolePerms s
JOIN dbo.Roles       r ON r.Slug = s.RoleSlug
JOIN dbo.Permissions p ON p.Slug = s.PermSlug
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.RolePermissions rp
    WHERE rp.RoleId = r.Id AND rp.PermissionId = p.Id
);
GO
