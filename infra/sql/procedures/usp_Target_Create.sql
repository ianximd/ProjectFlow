-- Phase 8e: create a target under a goal. Validates the goal exists + Kind.
-- Position defaults to the count of existing targets (append). SELECT * of the row.
CREATE OR ALTER PROCEDURE dbo.usp_Target_Create
    @GoalId       UNIQUEIDENTIFIER,
    @Kind         NVARCHAR(10),
    @Name         NVARCHAR(300),
    @Unit         NVARCHAR(20) = NULL,
    @CurrencyCode CHAR(3) = NULL,
    @StartValue   FLOAT = NULL,
    @TargetValue  FLOAT = NULL,
    @CurrentValue FLOAT = NULL,
    @TaskFilter   NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF @Kind NOT IN ('number','boolean','currency','task')
            THROW 52801, 'Invalid target kind', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.Goals WHERE Id = @GoalId AND DeletedAt IS NULL)
            THROW 52802, 'Goal not found', 1;

        DECLARE @Id UNIQUEIDENTIFIER = NEWID();
        DECLARE @Pos FLOAT = (SELECT ISNULL(MAX(Position), -1) + 1 FROM dbo.Targets WHERE GoalId = @GoalId);

        INSERT INTO dbo.Targets (Id, GoalId, Kind, Name, Unit, CurrencyCode, StartValue, TargetValue, CurrentValue, TaskFilter, Position)
        VALUES (@Id, @GoalId, @Kind, @Name, @Unit, @CurrencyCode, @StartValue, @TargetValue, @CurrentValue, @TaskFilter, @Pos);
        SELECT * FROM dbo.Targets WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
