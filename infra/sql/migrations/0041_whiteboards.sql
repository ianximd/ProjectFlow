-- =============================================================================
-- Migration 0041: Whiteboards (Phase 7b)
-- A whiteboard is a scoped object (SPACE/FOLDER/LIST) whose live canvas is a
-- tldraw document synced over the shared Hocuspocus/Yjs collab server (7a),
-- doc name `whiteboard:<id>`.
--   * Whiteboards          — metadata + persisted tldraw state
--       DocYjs  VARBINARY(MAX) — live Yjs binary state (onStoreDocument)
--       DocJson NVARCHAR(MAX)  — rendered tldraw snapshot (SSR + search/AI)
--   * WhiteboardTaskLinks  — convert shape→task links it back (re-hydrate embeds)
-- Idempotent (catalog guards), GO-batched.
-- Rollback in rollback/0041_whiteboards.down.sql.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Whiteboards')
BEGIN
    CREATE TABLE dbo.Whiteboards (
        Id          UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId UNIQUEIDENTIFIER NOT NULL,
        ScopeType   NVARCHAR(12)     NOT NULL,
        ScopeId     UNIQUEIDENTIFIER NOT NULL,
        Name        NVARCHAR(255)    NOT NULL,
        DocYjs      VARBINARY(MAX)   NULL,
        DocJson     NVARCHAR(MAX)    NULL,
        CreatedById UNIQUEIDENTIFIER NOT NULL,
        CreatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        DeletedAt   DATETIME2        NULL,
        CONSTRAINT CK_Whiteboards_ScopeType CHECK (ScopeType IN ('SPACE','FOLDER','LIST')),
        CONSTRAINT FK_Whiteboards_Workspace FOREIGN KEY (WorkspaceId) REFERENCES dbo.Workspaces(Id),
        CONSTRAINT FK_Whiteboards_CreatedBy FOREIGN KEY (CreatedById) REFERENCES dbo.Users(Id)
    )
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Whiteboards_Scope' AND object_id = OBJECT_ID('dbo.Whiteboards'))
    CREATE NONCLUSTERED INDEX IX_Whiteboards_Scope
        ON dbo.Whiteboards (WorkspaceId, ScopeType, ScopeId) WHERE DeletedAt IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WhiteboardTaskLinks')
BEGIN
    CREATE TABLE dbo.WhiteboardTaskLinks (
        Id           UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        WhiteboardId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_WhiteboardTaskLinks_Whiteboard REFERENCES dbo.Whiteboards(Id) ON DELETE CASCADE,
        TaskId       UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_WhiteboardTaskLinks_Task       REFERENCES dbo.Tasks(Id)       ON DELETE CASCADE,
        ShapeId      NVARCHAR(100)    NOT NULL,   -- tldraw shape id the task was minted from
        CreatedById  UNIQUEIDENTIFIER NOT NULL,
        CreatedAt    DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_WhiteboardTaskLinks UNIQUE (WhiteboardId, TaskId, ShapeId)
    )
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WhiteboardTaskLinks_Whiteboard' AND object_id = OBJECT_ID('dbo.WhiteboardTaskLinks'))
    CREATE NONCLUSTERED INDEX IX_WhiteboardTaskLinks_Whiteboard
        ON dbo.WhiteboardTaskLinks (WhiteboardId);
GO
