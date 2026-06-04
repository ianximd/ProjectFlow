CREATE OR ALTER PROCEDURE dbo.usp_Tag_Create
    @Id UNIQUEIDENTIFIER, @SpaceId UNIQUEIDENTIFIER, @Name NVARCHAR(100), @Color NVARCHAR(7) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.Projects WHERE Id = @SpaceId AND Status <> 'DELETED')
            THROW 51340, 'Space not found', 1;
        INSERT INTO dbo.Labels (Id, ProjectId, Name, Color) VALUES (@Id, @SpaceId, @Name, COALESCE(@Color, '#6c63ff'));
        SELECT * FROM dbo.Labels WHERE Id = @Id;
    END TRY BEGIN CATCH THROW; END CATCH
END;
