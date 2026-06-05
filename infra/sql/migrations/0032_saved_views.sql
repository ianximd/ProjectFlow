-- =============================================================================
-- Migration 0032: SavedViews table — Phase 3 Views Engine.
--
-- Stores user-defined (and shared) views scoped to a LIST, FOLDER, SPACE,
-- or the entire workspace (EVERYTHING). Config is stored as JSON in the
-- NVARCHAR(MAX) column. Soft-delete via DeletedAt. Idempotent + GO-batched.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SavedViews')
BEGIN
    CREATE TABLE dbo.SavedViews (
        Id           UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId  UNIQUEIDENTIFIER NOT NULL,
        OwnerId      UNIQUEIDENTIFIER NOT NULL,
        ScopeType    NVARCHAR(12) NOT NULL,
        ScopeId      UNIQUEIDENTIFIER NULL,
        ScopePath    NVARCHAR(900) NULL,
        Type         NVARCHAR(10) NOT NULL,
        Name         NVARCHAR(255) NOT NULL,
        IsShared     BIT NOT NULL DEFAULT 0,
        IsDefault    BIT NOT NULL DEFAULT 0,
        Config       NVARCHAR(MAX) NOT NULL,
        Position     FLOAT NOT NULL DEFAULT 0,
        CreatedAt    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        DeletedAt    DATETIME2 NULL,
        CONSTRAINT CK_SavedViews_ScopeType  CHECK (ScopeType IN ('LIST','FOLDER','SPACE','EVERYTHING')),
        CONSTRAINT CK_SavedViews_Type       CHECK (Type IN ('list','board','table','calendar')),
        CONSTRAINT CK_SavedViews_ScopeId    CHECK (ScopeType = 'EVERYTHING' OR ScopeId IS NOT NULL),
        CONSTRAINT FK_SavedViews_Workspace  FOREIGN KEY (WorkspaceId) REFERENCES dbo.Workspaces(Id),
        CONSTRAINT FK_SavedViews_Owner      FOREIGN KEY (OwnerId) REFERENCES dbo.Users(Id)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SavedViews_Scope' AND object_id = OBJECT_ID('dbo.SavedViews'))
    CREATE NONCLUSTERED INDEX IX_SavedViews_Scope ON dbo.SavedViews (WorkspaceId, ScopeType, ScopeId, Position) WHERE DeletedAt IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SavedViews_Owner' AND object_id = OBJECT_ID('dbo.SavedViews'))
    CREATE NONCLUSTERED INDEX IX_SavedViews_Owner ON dbo.SavedViews (OwnerId) WHERE DeletedAt IS NULL;
GO
