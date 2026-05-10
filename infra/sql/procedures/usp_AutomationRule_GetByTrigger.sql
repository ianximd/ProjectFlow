-- usp_AutomationRule_GetByTrigger
-- Fetches enabled rules for a project that match a given trigger type
-- Used by the automation worker to find candidate rules on events
CREATE OR ALTER PROCEDURE dbo.usp_AutomationRule_GetByTrigger
  @ProjectId   UNIQUEIDENTIFIER,
  @TriggerType NVARCHAR(50)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT *
  FROM dbo.AutomationRules
  WHERE ProjectId = @ProjectId
    AND IsEnabled  = 1
    AND JSON_VALUE(TriggerConfig, '$.type') = @TriggerType
  ORDER BY CreatedAt ASC;
END;
GO
