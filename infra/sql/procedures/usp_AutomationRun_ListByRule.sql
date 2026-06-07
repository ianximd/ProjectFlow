-- usp_AutomationRun_ListByRule
-- Newest-first paginated run history for a single rule. Backs the run-history
-- endpoint (Phase 6a REST + GraphQL; the drawer UI lands in 6d).
CREATE OR ALTER PROCEDURE dbo.usp_AutomationRun_ListByRule
  @RuleId UNIQUEIDENTIFIER,
  @Limit  INT = 50,
  @Offset INT = 0
AS
BEGIN
  SET NOCOUNT ON;
  SELECT *
  FROM dbo.AutomationRuns
  WHERE RuleId = @RuleId
  ORDER BY StartedAt DESC
  OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;
END;
GO
