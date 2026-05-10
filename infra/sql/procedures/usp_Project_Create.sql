CREATE OR ALTER PROCEDURE usp_Project_Create
    @WorkspaceId UNIQUEIDENTIFIER,
    @Name        NVARCHAR(255),
    @Key         NVARCHAR(20),
    @Description NVARCHAR(MAX) = NULL,
    @Type        NVARCHAR(20)  = 'KANBAN',
    @CreatedById UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF EXISTS (SELECT 1 FROM Projects WHERE WorkspaceId = @WorkspaceId AND [Key] = @Key)
            THROW 50020, 'Project key already exists in this workspace.', 1;

        DECLARE @NewId UNIQUEIDENTIFIER = NEWID();

        INSERT INTO Projects (Id, WorkspaceId, Name, [Key], Description, Type, Status, CreatedById)
        VALUES (@NewId, @WorkspaceId, @Name, @Key, @Description, @Type, 'ACTIVE', @CreatedById);

        SELECT * FROM Projects WHERE Id = @NewId;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
