-- usp_AutomationRule_RecordExecution
-- Called after a rule fires to update stats
CREATE OR ALTER PROCEDURE dbo.usp_AutomationRule_RecordExecution
  @Id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.AutomationRules SET
    ExecutionCount = ExecutionCount + 1,
    LastExecutedAt = GETUTCDATE(),
    UpdatedAt      = GETUTCDATE()
  WHERE Id = @Id;
END;
GO
