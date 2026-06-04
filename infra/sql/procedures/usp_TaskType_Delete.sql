CREATE OR ALTER PROCEDURE dbo.usp_TaskType_Delete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        DECLARE @WorkspaceId UNIQUEIDENTIFIER, @IsDefault BIT;
        SELECT @WorkspaceId = WorkspaceId, @IsDefault = IsDefault FROM dbo.TaskTypes WHERE Id = @Id AND DeletedAt IS NULL;
        IF @WorkspaceId IS NULL THROW 51320, 'Task type not found', 1;
        IF @IsDefault = 1 THROW 51321, 'Cannot delete the default task type', 1;
        BEGIN TRANSACTION;
        DECLARE @DefId UNIQUEIDENTIFIER = (SELECT TOP 1 Id FROM dbo.TaskTypes WHERE WorkspaceId = @WorkspaceId AND IsDefault = 1 AND DeletedAt IS NULL);
        UPDATE dbo.Tasks SET TaskTypeId = @DefId, Type = 'TASK' WHERE TaskTypeId = @Id;
        UPDATE dbo.TaskTypes SET DeletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id;
        COMMIT TRANSACTION;
        SELECT * FROM dbo.TaskTypes WHERE Id = @Id;
    END TRY BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION; THROW; END CATCH
END;
