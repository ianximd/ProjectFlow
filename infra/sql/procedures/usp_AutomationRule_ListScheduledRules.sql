-- usp_AutomationRule_ListScheduledRules
-- Phase 6c — read-only, scheduler-facing.
-- Returns all enabled SCHEDULED rules so the worker can evaluate each cron
-- expression in TypeScript and decide which rules are due to fire.
CREATE OR ALTER PROCEDURE dbo.usp_AutomationRule_ListScheduledRules
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        r.Id           AS RuleId,
        r.ScopeType,
        r.WorkspaceId,
        r.ProjectId,
        r.TriggerConfig,
        JSON_VALUE(r.TriggerConfig, '$.type') AS TriggerType
    FROM dbo.AutomationRules r
    WHERE r.IsEnabled = 1
      AND JSON_VALUE(r.TriggerConfig, '$.type') = 'SCHEDULED'
    ORDER BY r.WorkspaceId;
END;
GO
