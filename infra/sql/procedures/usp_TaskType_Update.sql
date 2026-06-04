CREATE OR ALTER PROCEDURE dbo.usp_TaskType_Update
    @Id UNIQUEIDENTIFIER, @NameSingular NVARCHAR(100) = NULL, @NamePlural NVARCHAR(100) = NULL,
    @Icon NVARCHAR(50) = NULL, @ClearIcon BIT = 0, @Position FLOAT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.TaskTypes WHERE Id = @Id AND DeletedAt IS NULL)
            THROW 51320, 'Task type not found', 1;
        UPDATE dbo.TaskTypes
        SET NameSingular = COALESCE(@NameSingular, NameSingular),
            NamePlural   = COALESCE(@NamePlural, NamePlural),
            Icon         = CASE WHEN @ClearIcon = 1 THEN NULL ELSE COALESCE(@Icon, Icon) END,
            Position     = COALESCE(@Position, Position),
            UpdatedAt    = SYSUTCDATETIME()
        WHERE Id = @Id;
        SELECT * FROM dbo.TaskTypes WHERE Id = @Id;
    END TRY BEGIN CATCH THROW; END CATCH
END;
