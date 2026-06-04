CREATE OR ALTER PROCEDURE dbo.usp_TaskType_Create
    @Id UNIQUEIDENTIFIER, @WorkspaceId UNIQUEIDENTIFIER, @NameSingular NVARCHAR(100),
    @NamePlural NVARCHAR(100), @Icon NVARCHAR(50) = NULL, @IsMilestone BIT = 0, @Position FLOAT = 0
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        INSERT INTO dbo.TaskTypes (Id, WorkspaceId, NameSingular, NamePlural, Icon, IsMilestone, IsDefault, Position)
        VALUES (@Id, @WorkspaceId, @NameSingular, @NamePlural, @Icon, @IsMilestone, 0, @Position);
        SELECT * FROM dbo.TaskTypes WHERE Id = @Id;
    END TRY BEGIN CATCH THROW; END CATCH
END;
