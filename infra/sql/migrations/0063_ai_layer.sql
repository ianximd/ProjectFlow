-- =============================================================================
-- Migration 0063: AI Layer — chunk index + gateway audit (Phase 11a)
--   * AiChunks — per-object content chunks with optional embeddings and
--                full-text indexing (FTS-guarded: silently skipped when
--                SERVERPROPERTY('IsFullTextInstalled') = 0, degrades to LIKE).
--   * AiRuns   — per-request gateway audit (provider, model, tokens, latency).
-- Idempotent (catalog/NOT EXISTS guards), GO-batched.
-- Rollback in rollback/0063_ai_layer.down.sql.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AiChunks')
BEGIN
    CREATE TABLE dbo.AiChunks (
        Id             UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_AiChunks PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId    UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Workspaces(Id),
        ObjectType     NVARCHAR(20)     NOT NULL,
        ObjectId       UNIQUEIDENTIFIER NOT NULL,
        ScopeType      NVARCHAR(10)     NOT NULL,
        ScopeId        UNIQUEIDENTIFIER NOT NULL,
        ListId         UNIQUEIDENTIFIER NULL,
        ChunkSeq       INT              NOT NULL,
        Content        NVARCHAR(MAX)    NOT NULL,
        Embedding      VARBINARY(MAX)   NULL,
        EmbeddingModel NVARCHAR(60)     NULL,
        ContentHash    CHAR(64)         NOT NULL,
        TokenCount     INT              NOT NULL,
        CreatedAt      DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt      DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        DeletedAt      DATETIME2        NULL,
        CONSTRAINT CK_AiChunks_ObjectType CHECK (ObjectType IN ('task','doc','comment')),
        CONSTRAINT CK_AiChunks_ScopeType  CHECK (ScopeType  IN ('SPACE','FOLDER','LIST'))
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AiChunks_Object' AND object_id = OBJECT_ID('dbo.AiChunks'))
    CREATE INDEX IX_AiChunks_Object ON dbo.AiChunks (WorkspaceId, ObjectType, ObjectId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AiChunks_Scope' AND object_id = OBJECT_ID('dbo.AiChunks'))
    CREATE INDEX IX_AiChunks_Scope ON dbo.AiChunks (WorkspaceId, ScopeType, ScopeId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AiChunks_List' AND object_id = OBJECT_ID('dbo.AiChunks'))
    CREATE INDEX IX_AiChunks_List ON dbo.AiChunks (WorkspaceId, ListId);
GO

-- Full-text: catalog + index keyed on the named PK (PK_AiChunks).
-- Guarded: CREATE FULLTEXT ... must be the first statement in its batch,
-- so dynamic SQL is used inside the IsFullTextInstalled guard.
IF CAST(SERVERPROPERTY('IsFullTextInstalled') AS INT) = 1
   AND NOT EXISTS (SELECT 1 FROM sys.fulltext_catalogs WHERE name = 'ftAiChunks')
    EXEC('CREATE FULLTEXT CATALOG ftAiChunks');
GO
IF CAST(SERVERPROPERTY('IsFullTextInstalled') AS INT) = 1
   AND NOT EXISTS (SELECT 1 FROM sys.fulltext_indexes i
                   JOIN sys.tables t ON t.object_id = i.object_id
                   WHERE t.name = 'AiChunks')
    EXEC('CREATE FULLTEXT INDEX ON dbo.AiChunks (Content) KEY INDEX PK_AiChunks ON ftAiChunks');
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AiRuns')
BEGIN
    CREATE TABLE dbo.AiRuns (
        Id               UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_AiRuns PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId      UNIQUEIDENTIFIER NOT NULL,
        UserId           UNIQUEIDENTIFIER NOT NULL,
        Feature          NVARCHAR(20)     NOT NULL,
        Provider         NVARCHAR(40)     NULL,
        Model            NVARCHAR(60)     NULL,
        Status           NVARCHAR(10)     NOT NULL,
        PromptTokens     INT              NULL,
        CompletionTokens INT              NULL,
        LatencyMs        INT              NULL,
        Error            NVARCHAR(MAX)    NULL,
        CreatedAt        DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_AiRuns_Feature CHECK (Feature IN ('qa','ai_field','standup','nl_automation','writer','search')),
        CONSTRAINT CK_AiRuns_Status  CHECK (Status  IN ('ok','error','refused'))
    );
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AiRuns_Workspace' AND object_id = OBJECT_ID('dbo.AiRuns'))
    CREATE INDEX IX_AiRuns_Workspace ON dbo.AiRuns (WorkspaceId, CreatedAt);
GO
