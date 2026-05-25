-- =============================================================================
-- Migration 0016: Performance indexes for hot query paths
-- Week 24 — SP execution plan tuning
-- =============================================================================
-- Strategy: cover the WHERE / ORDER BY columns used by the highest-traffic SPs
-- so the query engine uses index seeks instead of table scans.
-- All indexes are CREATE … IF NOT EXISTS (SQL Server 2022) to be idempotent.
-- =============================================================================

-- ── Tasks ─────────────────────────────────────────────────────────────────────

-- Task list by project + status (Board, Backlog, Sprint board)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Task_ProjectId_Status' AND object_id = OBJECT_ID('dbo.Tasks'))
  CREATE NONCLUSTERED INDEX IX_Task_ProjectId_Status
    ON dbo.Tasks (ProjectId, Status)
    INCLUDE (Id, Title, Priority, SprintId, StoryPoints, DueDate, CreatedAt, UpdatedAt)
    WITH (FILLFACTOR = 85);
GO

-- Task list filtered by sprint
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Task_SprintId_Status' AND object_id = OBJECT_ID('dbo.Tasks'))
  CREATE NONCLUSTERED INDEX IX_Task_SprintId_Status
    ON dbo.Tasks (SprintId, Status)
    INCLUDE (Id, Title, Priority, ProjectId, StoryPoints, DueDate, CreatedAt)
    WHERE SprintId IS NOT NULL
    WITH (FILLFACTOR = 85);
GO

-- Task list filtered by reporter (My Issues)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Task_ReporterId_Status' AND object_id = OBJECT_ID('dbo.Tasks'))
  CREATE NONCLUSTERED INDEX IX_Task_ReporterId_Status
    ON dbo.Tasks (ReporterId, Status)
    INCLUDE (Id, Title, Priority, ProjectId, SprintId, DueDate, CreatedAt)
    WITH (FILLFACTOR = 85);
GO

-- Task search (full-text backed by a filtered index on DeletedAt IS NULL)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Task_ProjectId_DeletedAt' AND object_id = OBJECT_ID('dbo.Tasks'))
  CREATE NONCLUSTERED INDEX IX_Task_ProjectId_DeletedAt
    ON dbo.Tasks (ProjectId, DeletedAt)
    INCLUDE (Id, Title, Status, Priority, CreatedAt)
    WHERE DeletedAt IS NULL
    WITH (FILLFACTOR = 90);
GO

-- ── Comments ──────────────────────────────────────────────────────────────────

-- Comment list per task (chronological)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Comment_TaskId_CreatedAt' AND object_id = OBJECT_ID('dbo.Comments'))
  CREATE NONCLUSTERED INDEX IX_Comment_TaskId_CreatedAt
    ON dbo.Comments (TaskId, CreatedAt DESC)
    INCLUDE (Id, AuthorId, Body, UpdatedAt, DeletedAt)
    WHERE DeletedAt IS NULL
    WITH (FILLFACTOR = 85);
GO

-- ── Notifications ─────────────────────────────────────────────────────────────

-- Notification list per user, unread first
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Notification_UserId_Read_CreatedAt' AND object_id = OBJECT_ID('dbo.Notifications'))
  CREATE NONCLUSTERED INDEX IX_Notification_UserId_Read_CreatedAt
    ON dbo.Notifications (UserId, IsRead, CreatedAt DESC)
    INCLUDE (Id, Type, Payload)
    WITH (FILLFACTOR = 80);
GO

-- ── Workspace members ─────────────────────────────────────────────────────────

-- Membership lookup by workspace + user
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WorkspaceMember_WorkspaceId_UserId' AND object_id = OBJECT_ID('dbo.WorkspaceMembers'))
  CREATE NONCLUSTERED INDEX IX_WorkspaceMember_WorkspaceId_UserId
    ON dbo.WorkspaceMembers (WorkspaceId, UserId)
    INCLUDE (Role, JoinedAt);
GO

-- ── Projects ──────────────────────────────────────────────────────────────────

-- Project list per workspace
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Project_WorkspaceId_Status' AND object_id = OBJECT_ID('dbo.Projects'))
  CREATE NONCLUSTERED INDEX IX_Project_WorkspaceId_Status
    ON dbo.Projects (WorkspaceId, Status)
    INCLUDE (Id, Name, [Key], Description, CreatedAt)
    WITH (FILLFACTOR = 90);
GO

-- ── Sprints ───────────────────────────────────────────────────────────────────

-- Active sprint lookup
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Sprint_ProjectId_Status' AND object_id = OBJECT_ID('dbo.Sprints'))
  CREATE NONCLUSTERED INDEX IX_Sprint_ProjectId_Status
    ON dbo.Sprints (ProjectId, Status)
    INCLUDE (Id, Name, Goal, StartDate, EndDate)
    WITH (FILLFACTOR = 90);
GO

-- ── Audit log ─────────────────────────────────────────────────────────────────
-- (AuditLog indexes were already created in 0015 — only fill-factor update here)

-- ── WorkLogs ──────────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WorkLog_TaskId_StartedAt' AND object_id = OBJECT_ID('dbo.WorkLogs'))
  CREATE NONCLUSTERED INDEX IX_WorkLog_TaskId_StartedAt
    ON dbo.WorkLogs (TaskId, StartedAt DESC)
    INCLUDE (Id, UserId, TimeSpentSeconds, Description)
    WITH (FILLFACTOR = 85);
GO

-- ── Statistics: update statistics on hot tables ───────────────────────────────
UPDATE STATISTICS dbo.Tasks       WITH FULLSCAN;
UPDATE STATISTICS dbo.Comments    WITH FULLSCAN;
UPDATE STATISTICS dbo.Notifications WITH FULLSCAN;
UPDATE STATISTICS dbo.WorkspaceMembers WITH FULLSCAN;
UPDATE STATISTICS dbo.Projects    WITH FULLSCAN;
UPDATE STATISTICS dbo.Sprints     WITH FULLSCAN;
GO
