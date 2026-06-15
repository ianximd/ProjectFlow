-- =============================================================================
-- Migration 0056: View types union + Gantt baselines (Phase 9d)
--   * Expand CK_SavedViews_Type from the current six-type cap
--     ('list','board','table','calendar','workload','box' — last two added by
--     0048) to the FULL view-type union:
--       list, board, table, calendar, workload, box, gantt, timeline,
--       activity, map, mindmap, embed, chat, doc
--     so the DB CHECK, the ViewType union (packages/types), and the GraphQL
--     VIEW_TYPES allow-list all agree; 9d adds gantt/timeline renderers and
--     9e/9f add renderers for activity/map/mindmap/embed/chat/doc.
--   * Baselines + BaselineTasks — a frozen snapshot of task dates per view,
--     for the Gantt planned-vs-actual overlay.
-- Idempotent (constraint/table guards), GO-batched.
-- Rollback in rollback/0056_view_types_and_baselines.down.sql.
-- NOTE: renumbered from the plan's 0049 — on-disk tip was 0055 when this slice ran.
-- =============================================================================

-- ── Expand the SavedViews.Type CHECK to the full union (drop + recreate) ──────
-- Drop-and-recreate is the only safe edit to a CHECK constraint. Guard the drop
-- so a re-apply is a clean no-op; the recreate is unconditional after the drop.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_SavedViews_Type' AND parent_object_id = OBJECT_ID('dbo.SavedViews'))
    ALTER TABLE dbo.SavedViews DROP CONSTRAINT CK_SavedViews_Type;
GO

ALTER TABLE dbo.SavedViews WITH CHECK ADD CONSTRAINT CK_SavedViews_Type
    CHECK (Type IN (
        'list','board','table','calendar','workload','box',
        'gantt','timeline','activity','map','mindmap','embed','chat','doc'
    ));
GO

-- ── Baselines: a named, frozen snapshot of a view's task dates ────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Baselines')
BEGIN
    CREATE TABLE dbo.Baselines (
        Id         UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Baselines PRIMARY KEY DEFAULT NEWID(),
        ViewId     UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_Baselines_View REFERENCES dbo.SavedViews(Id) ON DELETE CASCADE,
        Name       NVARCHAR(200)    NOT NULL,
        CapturedAt DATETIME2        NOT NULL CONSTRAINT DF_Baselines_CapturedAt DEFAULT SYSUTCDATETIME(),
        CreatedBy  UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_Baselines_User REFERENCES dbo.Users(Id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Baselines_View' AND object_id = OBJECT_ID('dbo.Baselines'))
    CREATE NONCLUSTERED INDEX IX_Baselines_View ON dbo.Baselines (ViewId, CapturedAt DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'BaselineTasks')
BEGIN
    CREATE TABLE dbo.BaselineTasks (
        BaselineId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_BaselineTasks_Baseline REFERENCES dbo.Baselines(Id) ON DELETE CASCADE,
        TaskId     UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_BaselineTasks_Task REFERENCES dbo.Tasks(Id),
        -- StartDate is DATE (Gantt drag is day-granular); DueDate is DATETIME2,
        -- mirroring Tasks.StartDate/DueDate (migration 0024).
        StartDate  DATE             NULL,
        DueDate    DATETIME2        NULL,
        CONSTRAINT PK_BaselineTasks PRIMARY KEY (BaselineId, TaskId)
    );
END
GO
