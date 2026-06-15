CREATE OR ALTER PROCEDURE dbo.usp_Workspace_GetVerifiedDomain
  @Id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT VerifiedDomain FROM dbo.Workspaces WHERE Id = @Id;
END;
GO
