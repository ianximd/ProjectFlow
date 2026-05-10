CREATE OR ALTER PROCEDURE usp_Attachment_List
    @TaskId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        a.Id,
        a.TaskId,
        a.UploadedById,
        a.FileName,
        a.FileSize,
        a.MimeType,
        a.StorageKey,
        a.BucketName,
        a.CreatedAt,
        a.UpdatedAt,
        u.Name      AS UploaderName,
        u.AvatarUrl AS UploaderAvatarUrl
    FROM Attachments a
    JOIN Users u ON u.Id = a.UploadedById
    WHERE a.TaskId   = @TaskId
      AND a.DeletedAt IS NULL
    ORDER BY a.CreatedAt DESC;
END;
