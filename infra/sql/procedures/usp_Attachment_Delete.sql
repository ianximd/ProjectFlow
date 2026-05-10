CREATE OR ALTER PROCEDURE usp_Attachment_Delete
    @Id          UNIQUEIDENTIFIER,
    @RequesterId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    -- Soft-delete; only the uploader may delete their own attachment
    UPDATE Attachments
    SET    DeletedAt = GETUTCDATE(),
           UpdatedAt = GETUTCDATE()
    WHERE  Id          = @Id
      AND  UploadedById = @RequesterId
      AND  DeletedAt   IS NULL;

    IF @@ROWCOUNT = 0
        RAISERROR('ATTACHMENT_NOT_FOUND_OR_NOT_OWNER', 16, 1);

    -- Return the storage key so the caller can remove the object from MinIO
    SELECT StorageKey, BucketName FROM Attachments WHERE Id = @Id;
END;
