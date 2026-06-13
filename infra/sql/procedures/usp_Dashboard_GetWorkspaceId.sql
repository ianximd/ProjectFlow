CREATE OR ALTER PROCEDURE dbo.usp_Dashboard_GetWorkspaceId
  @Id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT WorkspaceId FROM dbo.Dashboards WHERE Id = @Id AND DeletedAt IS NULL;
END;
GO
