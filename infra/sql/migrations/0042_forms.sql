-- =============================================================================
-- Migration 0042: Forms (Phase 7c — intake)
-- Two tables:
--   * Forms — one intake form. Config (fields[] + branching) and FieldMapping
--     (form field -> task field / custom-field id) are JSON in NVARCHAR(MAX),
--     mirroring SavedViews.Config / Templates.Snapshot. TargetListId is the list
--     a submission's task is created in; TemplateId optionally applies a Phase 5d
--     task template on submit. Public surface: IsPublic + PublicSlug (unique while
--     live) + AuthRequired. Soft-delete via DeletedAt.
--   * FormSubmissions — one row per submit. Answers JSON, CreatedTaskId (the task
--     the submission spawned), SubmittedById (NULL for anonymous public submits).
-- Idempotent (catalog guards), GO-batched.
-- Rollback in rollback/0042_forms.down.sql.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Forms')
BEGIN
    CREATE TABLE dbo.Forms (
        Id           UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId  UNIQUEIDENTIFIER NOT NULL,
        ScopeType    NVARCHAR(8)      NOT NULL,   -- 'SPACE' | 'FOLDER' | 'LIST'
        ScopeId      UNIQUEIDENTIFIER NOT NULL,
        Name         NVARCHAR(255)    NOT NULL,
        Config       NVARCHAR(MAX)    NOT NULL,   -- JSON: { fields:[...], branching:[...] }
        TargetListId UNIQUEIDENTIFIER NOT NULL,
        FieldMapping NVARCHAR(MAX)    NOT NULL,   -- JSON: { <formFieldKey>: { kind, target } }
        TemplateId   UNIQUEIDENTIFIER NULL,       -- optional Phase 5d task template
        IsPublic     BIT              NOT NULL CONSTRAINT DF_Forms_IsPublic     DEFAULT 0,
        PublicSlug   NVARCHAR(64)     NULL,
        AuthRequired BIT              NOT NULL CONSTRAINT DF_Forms_AuthRequired DEFAULT 0,
        CreatedById  UNIQUEIDENTIFIER NOT NULL,
        CreatedAt    DATETIME2        NOT NULL CONSTRAINT DF_Forms_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt    DATETIME2        NOT NULL CONSTRAINT DF_Forms_UpdatedAt DEFAULT SYSUTCDATETIME(),
        DeletedAt    DATETIME2        NULL,
        CONSTRAINT CK_Forms_Scope CHECK (ScopeType IN ('SPACE','FOLDER','LIST')),
        CONSTRAINT FK_Forms_Workspace FOREIGN KEY (WorkspaceId) REFERENCES dbo.Workspaces(Id),
        CONSTRAINT FK_Forms_TargetList FOREIGN KEY (TargetListId) REFERENCES dbo.Lists(Id),
        CONSTRAINT FK_Forms_CreatedBy  FOREIGN KEY (CreatedById)  REFERENCES dbo.Users(Id)
    );
END
GO

-- A live public form's slug must be globally unique (it's the unauthenticated
-- entry point). Filtered so soft-deleted / non-public rows don't collide.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Forms_PublicSlug' AND object_id = OBJECT_ID('dbo.Forms'))
    CREATE UNIQUE NONCLUSTERED INDEX UQ_Forms_PublicSlug
        ON dbo.Forms (PublicSlug)
        WHERE PublicSlug IS NOT NULL AND DeletedAt IS NULL;
GO

-- Form Center cover: a workspace's live forms, optionally narrowed by scope.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Forms_Workspace_Scope' AND object_id = OBJECT_ID('dbo.Forms'))
    CREATE NONCLUSTERED INDEX IX_Forms_Workspace_Scope
        ON dbo.Forms (WorkspaceId, ScopeType, ScopeId) WHERE DeletedAt IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FormSubmissions')
BEGIN
    CREATE TABLE dbo.FormSubmissions (
        Id            UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        FormId        UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_FormSubmissions_Form REFERENCES dbo.Forms(Id) ON DELETE CASCADE,
        Answers       NVARCHAR(MAX)    NOT NULL,   -- JSON: { <formFieldKey>: value }
        CreatedTaskId UNIQUEIDENTIFIER NULL
            CONSTRAINT FK_FormSubmissions_Task REFERENCES dbo.Tasks(Id),
        SubmittedById UNIQUEIDENTIFIER NULL        -- NULL = anonymous public submit
            CONSTRAINT FK_FormSubmissions_User REFERENCES dbo.Users(Id),
        SubmittedAt   DATETIME2        NOT NULL CONSTRAINT DF_FormSubmissions_SubmittedAt DEFAULT SYSUTCDATETIME()
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FormSubmissions_Form' AND object_id = OBJECT_ID('dbo.FormSubmissions'))
    CREATE NONCLUSTERED INDEX IX_FormSubmissions_Form ON dbo.FormSubmissions (FormId, SubmittedAt DESC);
GO
