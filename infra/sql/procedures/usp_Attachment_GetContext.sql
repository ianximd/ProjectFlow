CREATE OR ALTER PROCEDURE dbo.usp_Attachment_GetContext
    @AttachmentId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1
        t.WorkspaceId,
        a.UploadedById AS OwnerId
    FROM dbo.Attachments a
    JOIN dbo.Tasks       t ON t.Id = a.TaskId
    WHERE a.Id = @AttachmentId
      AND t.DeletedAt IS NULL
      AND a.DeletedAt IS NULL;
END;
