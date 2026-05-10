CREATE OR ALTER PROCEDURE dbo.usp_Admin_GetStats
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    (SELECT COUNT(*) FROM dbo.Users      WHERE DeletedAt IS NULL)  AS TotalUsers,
    (SELECT COUNT(*) FROM dbo.Workspaces)                          AS TotalWorkspaces,
    (SELECT COUNT(*) FROM dbo.Projects)                            AS TotalProjects,
    (SELECT COUNT(*) FROM dbo.Tasks      WHERE DeletedAt IS NULL)  AS TotalTasks,
    (SELECT COUNT(*) FROM dbo.Tasks
     WHERE  DeletedAt IS NULL
       AND  CreatedAt >= CAST(GETUTCDATE() AS DATE))               AS TasksCreatedToday,
    (SELECT COUNT(*) FROM dbo.AuditLog
     WHERE  Action = 'LOGIN'
       AND  CreatedAt >= DATEADD(HOUR, -24, GETUTCDATE()))         AS LoginsLast24h,
    (SELECT COUNT(*) FROM dbo.AuditLog
     WHERE  CreatedAt >= CAST(GETUTCDATE() AS DATE))               AS AuditEventsToday;
END;
