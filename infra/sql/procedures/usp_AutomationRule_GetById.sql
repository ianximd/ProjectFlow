-- Single-row read for the audit-snapshot fetcher (Phase 6 W43 Option A
-- extension). Returns the canonical AutomationRule row by primary key,
-- including the JSON config blobs so the audit diff records "the trigger
-- changed from X to Y" not just "the rule was updated."
CREATE OR ALTER PROCEDURE dbo.usp_AutomationRule_GetById
    @RuleId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1
           Id,
           ProjectId,
           WorkspaceId,
           ScopeType,
           ScopeId,
           Name,
           IsEnabled,
           TriggerConfig,
           ConditionConfig,
           ActionConfig,
           ExecutionCount,
           LastExecutedAt,
           CreatedAt,
           UpdatedAt
    FROM   dbo.AutomationRules
    WHERE  Id = @RuleId;
END;
GO
