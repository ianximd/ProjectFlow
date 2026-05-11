-- =============================================================================
-- Migration 0024: Tasks.DueDate gains time precision
-- =============================================================================
-- DueDate was declared as DATE in 0001_init.sql, which means deadlines could
-- only be set to a calendar day — no "by 17:00" precision. Users asked for
-- time-of-day deadlines on the board, so we widen the column to DATETIME2.
--
-- The widening is safe: every existing DATE value implicitly becomes the same
-- date at 00:00:00, so reports / filters that compare against today's date
-- still return the same rows.
--
-- StartDate stays DATE — the only producer is the Gantt drag-to-set-dates
-- flow on the roadmap, which is a day-granular planning view.
--
-- Three non-clustered indexes from 0016_perf_indexes.sql carry DueDate in
-- their INCLUDE list, so we drop and recreate them around the column change.
-- =============================================================================

DECLARE @colType NVARCHAR(50);
SELECT @colType = DATA_TYPE
FROM   INFORMATION_SCHEMA.COLUMNS
WHERE  TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Tasks' AND COLUMN_NAME = 'DueDate';

IF @colType IS NOT NULL AND @colType <> 'datetime2'
BEGIN
    IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Task_ProjectId_Status'  AND object_id = OBJECT_ID('dbo.Tasks'))
        DROP INDEX IX_Task_ProjectId_Status  ON dbo.Tasks;
    IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Task_SprintId_Status'   AND object_id = OBJECT_ID('dbo.Tasks'))
        DROP INDEX IX_Task_SprintId_Status   ON dbo.Tasks;
    IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Task_ReporterId_Status' AND object_id = OBJECT_ID('dbo.Tasks'))
        DROP INDEX IX_Task_ReporterId_Status ON dbo.Tasks;

    ALTER TABLE dbo.Tasks ALTER COLUMN DueDate DATETIME2 NULL;

    -- Recreate with the same shape as 0016_perf_indexes.sql.
    CREATE NONCLUSTERED INDEX IX_Task_ProjectId_Status
      ON dbo.Tasks (ProjectId, Status)
      INCLUDE (Id, Title, Priority, SprintId, StoryPoints, DueDate, CreatedAt, UpdatedAt)
      WITH (FILLFACTOR = 85);

    CREATE NONCLUSTERED INDEX IX_Task_SprintId_Status
      ON dbo.Tasks (SprintId, Status)
      INCLUDE (Id, Title, Priority, ProjectId, StoryPoints, DueDate, CreatedAt)
      WHERE SprintId IS NOT NULL
      WITH (FILLFACTOR = 85);

    CREATE NONCLUSTERED INDEX IX_Task_ReporterId_Status
      ON dbo.Tasks (ReporterId, Status)
      INCLUDE (Id, Title, Priority, ProjectId, SprintId, DueDate, CreatedAt)
      WITH (FILLFACTOR = 85);
END
GO
