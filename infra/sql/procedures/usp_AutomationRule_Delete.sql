-- usp_AutomationRule_Delete
CREATE OR ALTER PROCEDURE dbo.usp_AutomationRule_Delete
  @Id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DELETE FROM dbo.AutomationRules WHERE Id = @Id;
END;
GO
