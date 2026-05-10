-- usp_AutomationRule_List
CREATE OR ALTER PROCEDURE dbo.usp_AutomationRule_List
  @ProjectId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT * FROM dbo.AutomationRules
  WHERE ProjectId = @ProjectId
  ORDER BY CreatedAt DESC;
END;
GO
