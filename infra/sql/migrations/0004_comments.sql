-- Migration 0004: Comments and Comment Reactions
-- Adds: Comments, CommentReactions tables

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Comments')
BEGIN
    CREATE TABLE Comments (
        Id          UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
        TaskId      UNIQUEIDENTIFIER NOT NULL REFERENCES Tasks(Id),
        AuthorId    UNIQUEIDENTIFIER NOT NULL REFERENCES Users(Id),
        ParentId    UNIQUEIDENTIFIER NULL     REFERENCES Comments(Id),
        Body        NVARCHAR(MAX)    NOT NULL,
        IsEdited    BIT              NOT NULL DEFAULT 0,
        DeletedAt   DATETIME2        NULL,
        CreatedAt   DATETIME2        NOT NULL DEFAULT GETUTCDATE(),
        UpdatedAt   DATETIME2        NOT NULL DEFAULT GETUTCDATE()
    );

    CREATE INDEX IX_Comments_TaskId   ON Comments(TaskId)   WHERE DeletedAt IS NULL;
    CREATE INDEX IX_Comments_AuthorId ON Comments(AuthorId) WHERE DeletedAt IS NULL;
    CREATE INDEX IX_Comments_ParentId ON Comments(ParentId) WHERE ParentId IS NOT NULL AND DeletedAt IS NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CommentReactions')
BEGIN
    CREATE TABLE CommentReactions (
        Id         UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
        CommentId  UNIQUEIDENTIFIER NOT NULL REFERENCES Comments(Id),
        UserId     UNIQUEIDENTIFIER NOT NULL REFERENCES Users(Id),
        Emoji      NVARCHAR(20)     NOT NULL,
        CreatedAt  DATETIME2        NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT UQ_CommentReactions_User_Comment_Emoji UNIQUE (CommentId, UserId, Emoji)
    );

    CREATE INDEX IX_CommentReactions_CommentId ON CommentReactions(CommentId);
END;
