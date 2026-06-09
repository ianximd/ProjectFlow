-- usp_AutomationUsage_GetCurrent
-- Phase 6d: read-only metering — RunCount for (WorkspaceId, Period 'YYYYMM').
-- Returns 0 when no AutomationUsage row exists (read-only; NO enforcement).
CREATE OR ALTER PROCEDURE dbo.usp_AutomationUsage_GetCurrent
  @WorkspaceId UNIQUEIDENTIFIER,
  @Period      CHAR(6)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT
    @WorkspaceId AS WorkspaceId,
    @Period      AS Period,
    ISNULL((SELECT u.RunCount
              FROM dbo.AutomationUsage u
              WHERE u.WorkspaceId = @WorkspaceId AND u.Period = @Period), 0) AS RunCount;
END;
GO
