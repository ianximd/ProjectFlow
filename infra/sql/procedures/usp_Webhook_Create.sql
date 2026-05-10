CREATE OR ALTER PROCEDURE dbo.usp_Webhook_Create
    @WorkspaceId UNIQUEIDENTIFIER,
    @Name        NVARCHAR(100),
    @Url         NVARCHAR(500),
    @Secret      NVARCHAR(255),
    @Events      NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Id UNIQUEIDENTIFIER = NEWID();

    INSERT INTO dbo.Webhooks (Id, WorkspaceId, Name, Url, Secret, Events, IsActive, CreatedAt)
    VALUES (@Id, @WorkspaceId, @Name, @Url, @Secret, @Events, 1, SYSUTCDATETIME());

    SELECT Id, WorkspaceId, Name, Url, Events, IsActive, CreatedAt
    FROM   dbo.Webhooks
    WHERE  Id = @Id;
END;
