-- Migration 0033: Collaboration gaps (Phase 3.5)
-- Adds: Comments.AssignedToId/ResolvedAt/ResolvedById, CommentMentions table,
--       Notifications.SavedForLater/SavedAt, supporting indexes.
-- Depends on: 0004_comments.sql, 0006_notifications.sql

-- Comments: assigned + resolved state
IF COL_LENGTH('dbo.Comments', 'AssignedToId') IS NULL
    ALTER TABLE dbo.Comments ADD AssignedToId UNIQUEIDENTIFIER NULL
        CONSTRAINT FK_Comments_AssignedTo REFERENCES dbo.Users(Id);
GO
IF COL_LENGTH('dbo.Comments', 'ResolvedAt') IS NULL
    ALTER TABLE dbo.Comments ADD ResolvedAt DATETIME2 NULL;
GO
IF COL_LENGTH('dbo.Comments', 'ResolvedById') IS NULL
    ALTER TABLE dbo.Comments ADD ResolvedById UNIQUEIDENTIFIER NULL
        CONSTRAINT FK_Comments_ResolvedBy REFERENCES dbo.Users(Id);
GO

-- CommentMentions: idempotent record of parsed @mentions (audit + dedup)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CommentMentions')
BEGIN
    CREATE TABLE dbo.CommentMentions (
        CommentId       UNIQUEIDENTIFIER NOT NULL
            REFERENCES dbo.Comments(Id) ON DELETE CASCADE,
        MentionedUserId UNIQUEIDENTIFIER NOT NULL
            REFERENCES dbo.Users(Id),
        CreatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_CommentMentions PRIMARY KEY (CommentId, MentionedUserId)
    );
    CREATE NONCLUSTERED INDEX IX_CommentMentions_User
        ON dbo.CommentMentions (MentionedUserId);
END
GO

-- Notifications: save-for-later (used by slice 3.5c Inbox)
IF COL_LENGTH('dbo.Notifications', 'SavedForLater') IS NULL
    ALTER TABLE dbo.Notifications ADD SavedForLater BIT NOT NULL
        CONSTRAINT DF_Notifications_SavedForLater DEFAULT 0;
GO
IF COL_LENGTH('dbo.Notifications', 'SavedAt') IS NULL
    ALTER TABLE dbo.Notifications ADD SavedAt DATETIME2 NULL;
GO

-- Indexes for inbox/by-assignee filtering
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Comments_AssignedToId')
    CREATE NONCLUSTERED INDEX IX_Comments_AssignedToId
        ON dbo.Comments (AssignedToId) WHERE AssignedToId IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Notif_UserSaved')
    CREATE NONCLUSTERED INDEX IX_Notif_UserSaved
        ON dbo.Notifications (UserId, SavedForLater);
GO
