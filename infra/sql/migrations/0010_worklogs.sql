-- 0010_worklogs.sql
-- Creates the WorkLogs table for time tracking

IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = 'WorkLogs'
)
BEGIN
  CREATE TABLE dbo.WorkLogs (
    Id               UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_WorkLogs PRIMARY KEY DEFAULT NEWID(),
    TaskId           UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_WorkLogs_Task    REFERENCES dbo.Tasks(Id)  ON DELETE CASCADE,
    UserId           UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_WorkLogs_User    REFERENCES dbo.Users(Id),
    TimeSpentSeconds INT              NOT NULL,
    StartedAt        DATETIME2        NOT NULL,
    Description      NVARCHAR(500)    NULL,
    CreatedAt        DATETIME2        NOT NULL CONSTRAINT DF_WorkLogs_CreatedAt DEFAULT GETUTCDATE()
  );

  CREATE NONCLUSTERED INDEX IX_WorkLog_Task
    ON dbo.WorkLogs (TaskId)
    INCLUDE (UserId, TimeSpentSeconds, StartedAt, CreatedAt);

  CREATE NONCLUSTERED INDEX IX_WorkLog_User
    ON dbo.WorkLogs (UserId);
END
GO
