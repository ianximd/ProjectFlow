CREATE OR ALTER PROCEDURE dbo.usp_List_Update
    @Id            UNIQUEIDENTIFIER,
    @Name          NVARCHAR(255) = NULL,
    @WorkflowId    UNIQUEIDENTIFIER = NULL,
    @ClearWorkflow BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.Lists WHERE Id = @Id AND DeletedAt IS NULL)
            THROW 51210, 'List not found', 1;
        UPDATE dbo.Lists
        SET    Name       = COALESCE(@Name, Name),
               WorkflowId = CASE WHEN @ClearWorkflow = 1 THEN NULL ELSE COALESCE(@WorkflowId, WorkflowId) END,
               UpdatedAt  = SYSUTCDATETIME()
        WHERE  Id = @Id;
        SELECT * FROM dbo.Lists WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
