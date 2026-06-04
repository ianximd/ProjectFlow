-- =============================================================================
-- Migration 0030: Custom Fields + Task Types + Tags + Watchers (Phase 2)
-- New tables: CustomFields, TaskCustomFieldValues, TaskTypes, TaskWatchers.
-- Alters: Tasks.TaskTypeId (nullable FK), Projects.MultipleAssignees (BIT NOT NULL DEFAULT 1).
-- Backfill: seed default Task + Milestone TaskTypes per workspace; point existing Tasks at the default.
-- Idempotent. Forward-only; rollback in rollback/0030_custom_fields.down.sql.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CustomFields')
BEGIN
    CREATE TABLE dbo.CustomFields (
        Id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Workspaces(Id),
        ScopeType   NVARCHAR(8)      NOT NULL,
        ScopeId     UNIQUEIDENTIFIER NOT NULL,
        ScopePath   NVARCHAR(900)    NOT NULL,
        Type        NVARCHAR(20)     NOT NULL,
        Name        NVARCHAR(255)    NOT NULL,
        Config      NVARCHAR(MAX)    NULL,
        Required    BIT              NOT NULL DEFAULT 0,
        Position    FLOAT            NOT NULL DEFAULT 0,
        CreatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        DeletedAt   DATETIME2        NULL,
        CONSTRAINT CK_CustomFields_ScopeType CHECK (ScopeType IN ('SPACE','FOLDER','LIST')),
        CONSTRAINT CK_CustomFields_Type CHECK (Type IN (
            'text','text_area','number','currency','checkbox','date','url','email','phone',
            'dropdown','labels','rating','people','progress_manual','progress_auto'))
    );
    CREATE NONCLUSTERED INDEX IX_CustomFields_Scope ON dbo.CustomFields (ScopeType, ScopeId, Position);
    CREATE NONCLUSTERED INDEX IX_CustomFields_Path  ON dbo.CustomFields (ScopePath);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TaskCustomFieldValues')
BEGIN
    CREATE TABLE dbo.TaskCustomFieldValues (
        TaskId    UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Tasks(Id),
        FieldId   UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.CustomFields(Id),
        Value     NVARCHAR(MAX)    NULL,
        UpdatedAt DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_TaskCustomFieldValues PRIMARY KEY (TaskId, FieldId)
    );
    CREATE NONCLUSTERED INDEX IX_TCFV_Field ON dbo.TaskCustomFieldValues (FieldId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TaskTypes')
BEGIN
    CREATE TABLE dbo.TaskTypes (
        Id           UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId  UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Workspaces(Id),
        NameSingular NVARCHAR(100)    NOT NULL,
        NamePlural   NVARCHAR(100)    NOT NULL,
        Icon         NVARCHAR(50)     NULL,
        IsMilestone  BIT              NOT NULL DEFAULT 0,
        IsDefault    BIT              NOT NULL DEFAULT 0,
        Position     FLOAT            NOT NULL DEFAULT 0,
        CreatedAt    DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt    DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        DeletedAt    DATETIME2        NULL,
        CONSTRAINT UQ_TaskTypes_Name UNIQUE (WorkspaceId, NameSingular)
    );
    CREATE NONCLUSTERED INDEX IX_TaskTypes_Workspace ON dbo.TaskTypes (WorkspaceId, Position);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TaskWatchers')
BEGIN
    CREATE TABLE dbo.TaskWatchers (
        TaskId    UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Tasks(Id),
        UserId    UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Users(Id),
        CreatedAt DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_TaskWatchers PRIMARY KEY (TaskId, UserId)
    );
    CREATE NONCLUSTERED INDEX IX_TaskWatchers_User ON dbo.TaskWatchers (UserId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Tasks') AND name = 'TaskTypeId')
BEGIN
    ALTER TABLE dbo.Tasks ADD TaskTypeId UNIQUEIDENTIFIER NULL REFERENCES dbo.TaskTypes(Id);
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Tasks_TaskType' AND object_id = OBJECT_ID('dbo.Tasks'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Tasks_TaskType ON dbo.Tasks (TaskTypeId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Projects') AND name = 'MultipleAssignees')
BEGIN
    ALTER TABLE dbo.Projects ADD MultipleAssignees BIT NOT NULL DEFAULT 1;
END
GO

-- Backfill: seed default Task + Milestone task types per workspace, then point
-- existing tasks at their workspace's default. Re-runnable (NOT EXISTS guards).
BEGIN
    INSERT INTO dbo.TaskTypes (Id, WorkspaceId, NameSingular, NamePlural, Icon, IsMilestone, IsDefault, Position)
    SELECT NEWID(), w.Id, 'Task', 'Tasks', NULL, 0, 1, 0
    FROM   dbo.Workspaces w
    WHERE  NOT EXISTS (SELECT 1 FROM dbo.TaskTypes tt WHERE tt.WorkspaceId = w.Id AND tt.IsDefault = 1 AND tt.DeletedAt IS NULL);

    INSERT INTO dbo.TaskTypes (Id, WorkspaceId, NameSingular, NamePlural, Icon, IsMilestone, IsDefault, Position)
    SELECT NEWID(), w.Id, 'Milestone', 'Milestones', 'diamond', 1, 0, 1
    FROM   dbo.Workspaces w
    WHERE  NOT EXISTS (SELECT 1 FROM dbo.TaskTypes tt WHERE tt.WorkspaceId = w.Id AND tt.IsMilestone = 1 AND tt.DeletedAt IS NULL);

    UPDATE t
    SET    t.TaskTypeId = dft.Id
    FROM   dbo.Tasks t
    JOIN   dbo.TaskTypes dft ON dft.WorkspaceId = t.WorkspaceId AND dft.IsDefault = 1 AND dft.DeletedAt IS NULL
    WHERE  t.TaskTypeId IS NULL;
END
GO
