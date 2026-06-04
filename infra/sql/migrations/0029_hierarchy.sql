-- =============================================================================
-- Migration 0029: ClickUp-style nesting hierarchy (Phase 1)
-- Adds Folders + Lists under the existing Projects("Space") table, an object
-- permission ACL, materialized Path columns, and Task re-homing columns.
-- Idempotent. Backfill lives in a later batch of this same file (Task 2).
-- =============================================================================

-- ── Projects (= Space): visibility + subtask depth ──────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Projects') AND name = 'Visibility')
BEGIN
    ALTER TABLE dbo.Projects ADD Visibility NVARCHAR(10) NOT NULL DEFAULT 'PUBLIC';
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Projects_Visibility' AND parent_object_id = OBJECT_ID('dbo.Projects'))
BEGIN
    ALTER TABLE dbo.Projects ADD CONSTRAINT CK_Projects_Visibility CHECK (Visibility IN ('PUBLIC','PRIVATE'));
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Projects') AND name = 'MaxSubtaskDepth')
BEGIN
    ALTER TABLE dbo.Projects ADD MaxSubtaskDepth INT NULL;   -- NULL = unlimited
END
GO

-- ── Folders ─────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Folders')
BEGIN
    CREATE TABLE dbo.Folders (
        Id             UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId    UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Workspaces(Id),
        SpaceId        UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Projects(Id),
        ParentFolderId UNIQUEIDENTIFIER NULL     REFERENCES dbo.Folders(Id),
        Name           NVARCHAR(255)    NOT NULL,
        Position       FLOAT            NOT NULL DEFAULT 0,
        Path           NVARCHAR(900)    NOT NULL,
        WorkflowId     UNIQUEIDENTIFIER NULL     REFERENCES dbo.Workflows(Id),
        CreatedAt      DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt      DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        DeletedAt      DATETIME2        NULL
    );
    CREATE NONCLUSTERED INDEX IX_Folders_Space ON dbo.Folders (SpaceId, ParentFolderId, Position);
    CREATE NONCLUSTERED INDEX IX_Folders_Path  ON dbo.Folders (Path);
END
GO

-- ── Lists ────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Lists')
BEGIN
    CREATE TABLE dbo.Lists (
        Id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Workspaces(Id),
        SpaceId     UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Projects(Id),
        FolderId    UNIQUEIDENTIFIER NULL     REFERENCES dbo.Folders(Id),
        Name        NVARCHAR(255)    NOT NULL,
        Position    FLOAT            NOT NULL DEFAULT 0,
        Path        NVARCHAR(900)    NOT NULL,
        WorkflowId  UNIQUEIDENTIFIER NULL     REFERENCES dbo.Workflows(Id),
        IsDefault   BIT              NOT NULL DEFAULT 0,
        CreatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        DeletedAt   DATETIME2        NULL
    );
    CREATE NONCLUSTERED INDEX IX_Lists_Space ON dbo.Lists (SpaceId, FolderId, Position);
    CREATE NONCLUSTERED INDEX IX_Lists_Path  ON dbo.Lists (Path);
END
GO

-- ── Tasks: ListId + ListPath + ArchivedAt ───────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Tasks') AND name = 'ListId')
BEGIN
    ALTER TABLE dbo.Tasks ADD ListId UNIQUEIDENTIFIER NULL REFERENCES dbo.Lists(Id);
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Tasks') AND name = 'ListPath')
BEGIN
    ALTER TABLE dbo.Tasks ADD ListPath NVARCHAR(900) NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Tasks') AND name = 'ArchivedAt')
BEGIN
    ALTER TABLE dbo.Tasks ADD ArchivedAt DATETIME2 NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Tasks_List' AND object_id = OBJECT_ID('dbo.Tasks'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Tasks_List ON dbo.Tasks (ListId, Status, Position);
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Tasks_ListPath' AND object_id = OBJECT_ID('dbo.Tasks'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Tasks_ListPath ON dbo.Tasks (ListPath);
END
GO

-- ── Workflows: generalize scope to Folder/List (ProjectId retained) ─────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Workflows') AND name = 'FolderId')
BEGIN
    ALTER TABLE dbo.Workflows ADD FolderId UNIQUEIDENTIFIER NULL REFERENCES dbo.Folders(Id);
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Workflows') AND name = 'ListId')
BEGIN
    ALTER TABLE dbo.Workflows ADD ListId UNIQUEIDENTIFIER NULL REFERENCES dbo.Lists(Id);
END
GO

-- ── ObjectPermissions ACL ───────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ObjectPermissions')
BEGIN
    CREATE TABLE dbo.ObjectPermissions (
        Id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Workspaces(Id),
        SubjectType NVARCHAR(8)      NOT NULL,             -- 'USER' | 'ROLE'
        SubjectId   UNIQUEIDENTIFIER NOT NULL,            -- Users(Id) or Roles(Id)
        ObjectType  NVARCHAR(8)      NOT NULL,             -- 'SPACE' | 'FOLDER' | 'LIST'
        ObjectId    UNIQUEIDENTIFIER NOT NULL,
        Level       NVARCHAR(8)      NOT NULL,             -- 'VIEW'|'COMMENT'|'EDIT'|'FULL'
        CreatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_ObjPerm_SubjectType CHECK (SubjectType IN ('USER','ROLE')),
        CONSTRAINT CK_ObjPerm_ObjectType  CHECK (ObjectType IN ('SPACE','FOLDER','LIST')),
        CONSTRAINT CK_ObjPerm_Level       CHECK (Level IN ('VIEW','COMMENT','EDIT','FULL')),
        CONSTRAINT UQ_ObjPerm UNIQUE (SubjectType, SubjectId, ObjectType, ObjectId)
    );
    CREATE NONCLUSTERED INDEX IX_ObjPerm_Object  ON dbo.ObjectPermissions (ObjectType, ObjectId);
    CREATE NONCLUSTERED INDEX IX_ObjPerm_Subject ON dbo.ObjectPermissions (SubjectType, SubjectId);
END
GO

-- ── Backfill: one default List per Space + re-home tasks (idempotent) ───────
-- Re-runnable: only creates a default List for Spaces that lack one, and only
-- re-homes tasks whose ListId is still NULL.
BEGIN
    DECLARE @sid UNIQUEIDENTIFIER, @wsid UNIQUEIDENTIFIER, @pname NVARCHAR(255), @lid UNIQUEIDENTIFIER;
    DECLARE space_cur CURSOR LOCAL FAST_FORWARD FOR
        SELECT p.Id, p.WorkspaceId, p.Name
        FROM   dbo.Projects p
        WHERE  p.Status <> 'DELETED'
          AND  NOT EXISTS (SELECT 1 FROM dbo.Lists l WHERE l.SpaceId = p.Id AND l.IsDefault = 1 AND l.DeletedAt IS NULL);
    OPEN space_cur;
    FETCH NEXT FROM space_cur INTO @sid, @wsid, @pname;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @lid = NEWID();
        INSERT INTO dbo.Lists (Id, WorkspaceId, SpaceId, FolderId, Name, Position, Path, IsDefault)
        VALUES (@lid, @wsid, @sid, NULL, @pname, 0,
                '/' + CONVERT(NVARCHAR(36), @sid) + '/' + CONVERT(NVARCHAR(36), @lid) + '/', 1);
        FETCH NEXT FROM space_cur INTO @sid, @wsid, @pname;
    END
    CLOSE space_cur; DEALLOCATE space_cur;

    UPDATE t
    SET    t.ListId   = l.Id,
           t.ListPath = l.Path
    FROM   dbo.Tasks t
    JOIN   dbo.Lists l ON l.SpaceId = t.ProjectId AND l.IsDefault = 1 AND l.DeletedAt IS NULL
    WHERE  t.ListId IS NULL;
END
GO
