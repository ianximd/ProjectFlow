CREATE OR ALTER PROCEDURE dbo.usp_Label_Delete
  @Id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DELETE FROM dbo.TaskLabelLinks WHERE LabelId = @Id;
  DELETE FROM dbo.Labels          WHERE Id      = @Id;
END;
GO
