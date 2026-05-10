CREATE OR ALTER PROCEDURE usp_Attachment_Create
    @TaskId       UNIQUEIDENTIFIER,
    @UploadedById UNIQUEIDENTIFIER,
    @FileName     NVARCHAR(500),
    @FileSize     BIGINT,
    @MimeType     NVARCHAR(255),
    @StorageKey   NVARCHAR(1000),
    @BucketName   NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Id UNIQUEIDENTIFIER = NEWID();

    INSERT INTO Attachments (Id, TaskId, UploadedById, FileName, FileSize, MimeType, StorageKey, BucketName)
    VALUES (@Id, @TaskId, @UploadedById, @FileName, @FileSize, @MimeType, @StorageKey, @BucketName);

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
    WHERE a.Id = @Id;
END;
