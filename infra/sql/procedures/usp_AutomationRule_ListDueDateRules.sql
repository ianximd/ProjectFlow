-- usp_AutomationRule_ListDueDateRules
-- Phase 6c — read-only, scheduler-facing.
-- Returns one row per (rule, task) for every enabled DUE_DATE_PASSED / DATE_ARRIVED
-- rule whose scope overlaps a task whose DueDate crossed into the half-open window
-- (@Since, @Now].  Scope predicate mirrors usp_AutomationRule_GetByTrigger exactly:
--   PROJECT   scope: r.ScopeId = t.ProjectId
--   WORKSPACE scope: r.ScopeId = t.WorkspaceId
CREATE OR ALTER PROCEDURE dbo.usp_AutomationRule_ListDueDateRules
    @Since DATETIME2,
    @Now   DATETIME2
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        r.Id            AS RuleId,
        r.ScopeType,
        r.WorkspaceId,
        r.ProjectId,
        r.TriggerConfig,
        t.Id            AS TaskId,
        t.ProjectId     AS TaskProjectId,
        t.WorkspaceId   AS TaskWorkspaceId,
        JSON_VALUE(r.TriggerConfig, '$.type') AS TriggerType
    FROM dbo.AutomationRules r
    JOIN dbo.Tasks t
      ON  t.DeletedAt IS NULL
      AND t.DueDate IS NOT NULL
      AND t.DueDate >  @Since
      AND t.DueDate <= @Now
      AND (
            (r.ScopeType = 'PROJECT'   AND r.ScopeId = t.ProjectId)
         OR (r.ScopeType = 'WORKSPACE' AND r.ScopeId = t.WorkspaceId)
          )
    WHERE r.IsEnabled = 1
      AND JSON_VALUE(r.TriggerConfig, '$.type') IN ('DUE_DATE_PASSED', 'DATE_ARRIVED')
    ORDER BY t.DueDate;
END;
GO
