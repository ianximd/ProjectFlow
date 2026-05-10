-- Migration 0005: Attachments
-- Adds: Attachments table

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Attachments')
BEGIN
    CREATE TABLE Attachments (
        Id           UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
        TaskId       UNIQUEIDENTIFIER NOT NULL REFERENCES Tasks(Id),
        UploadedById UNIQUEIDENTIFIER NOT NULL REFERENCES Users(Id),
        FileName     NVARCHAR(500)    NOT NULL,
        FileSize     BIGINT           NOT NULL,
        MimeType     NVARCHAR(255)    NOT NULL,
        StorageKey   NVARCHAR(1000)   NOT NULL,   -- MinIO/S3 object key
        BucketName   NVARCHAR(255)    NOT NULL,
        DeletedAt    DATETIME2        NULL,
        CreatedAt    DATETIME2        NOT NULL DEFAULT GETUTCDATE(),
        UpdatedAt    DATETIME2        NOT NULL DEFAULT GETUTCDATE()
    );

    CREATE INDEX IX_Attachments_TaskId ON Attachments(TaskId) WHERE DeletedAt IS NULL;
    CREATE INDEX IX_Attachments_UploadedById ON Attachments(UploadedById);
END;
