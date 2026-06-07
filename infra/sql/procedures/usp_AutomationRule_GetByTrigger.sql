-- usp_AutomationRule_GetByTrigger
-- Fetches enabled rules matching a trigger type for either a PROJECT-scoped rule
-- (ScopeId = @ProjectId) or a WORKSPACE-scoped rule (ScopeId = @WorkspaceId).
-- Backs automation.bus#emitAutomationEvent. @ProjectId may be NULL for
-- workspace-only events; the OR short-circuits cleanly on NULL.
CREATE OR ALTER PROCEDURE dbo.usp_AutomationRule_GetByTrigger
  @ProjectId   UNIQUEIDENTIFIER = NULL,
  @WorkspaceId UNIQUEIDENTIFIER,
  @TriggerType NVARCHAR(50)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT *
  FROM dbo.AutomationRules
  WHERE IsEnabled = 1
    AND JSON_VALUE(TriggerConfig, '$.type') = @TriggerType
    AND (
          (ScopeType = 'PROJECT'   AND ScopeId = @ProjectId)
       OR (ScopeType = 'WORKSPACE' AND ScopeId = @WorkspaceId)
    )
  ORDER BY CreatedAt ASC;
END;
GO
