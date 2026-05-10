CREATE OR ALTER PROCEDURE dbo.usp_Component_Delete
  @Id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DELETE FROM dbo.TaskComponents   WHERE ComponentId = @Id;
  DELETE FROM dbo.ProjectComponents WHERE Id          = @Id;
END;
GO
