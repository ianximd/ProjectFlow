CREATE OR ALTER PROCEDURE dbo.usp_CustomField_Create
    @Id          UNIQUEIDENTIFIER,
    @WorkspaceId UNIQUEIDENTIFIER,
    @ScopeType   NVARCHAR(8),
    @ScopeId     UNIQUEIDENTIFIER,
    @ScopePath   NVARCHAR(900),
    @Type        NVARCHAR(20),
    @Name        NVARCHAR(255),
    @Config      NVARCHAR(MAX) = NULL,
    @Required    BIT = 0,
    @Position    FLOAT = 0
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        INSERT INTO dbo.CustomFields (Id, WorkspaceId, ScopeType, ScopeId, ScopePath, Type, Name, Config, Required, Position)
        VALUES (@Id, @WorkspaceId, @ScopeType, @ScopeId, @ScopePath, @Type, @Name, @Config, @Required, @Position);
        SELECT * FROM dbo.CustomFields WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
