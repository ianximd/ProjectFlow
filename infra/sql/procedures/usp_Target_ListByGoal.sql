-- Phase 8e: targets for a goal, ordered by Position then CreatedAt.
CREATE OR ALTER PROCEDURE dbo.usp_Target_ListByGoal
    @GoalId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        SELECT * FROM dbo.Targets WHERE GoalId = @GoalId ORDER BY Position ASC, CreatedAt ASC;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
