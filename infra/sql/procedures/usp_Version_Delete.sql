CREATE OR ALTER PROCEDURE dbo.usp_Version_Delete
  @Id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DELETE FROM dbo.TaskVersions WHERE VersionId = @Id;
  DELETE FROM dbo.Versions     WHERE Id        = @Id;
END;
GO
