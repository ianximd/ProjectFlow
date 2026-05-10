-- Migration: 0006 — Notifications table
-- Depends on: 0001_init.sql (Users)

IF NOT EXISTS (
    SELECT 1 FROM sys.tables WHERE name = 'Notifications'
)
BEGIN
    CREATE TABLE Notifications (
        Id        UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID()
                      CONSTRAINT PK_Notifications PRIMARY KEY,
        UserId    UNIQUEIDENTIFIER NOT NULL
                      CONSTRAINT FK_Notifications_Users REFERENCES Users(Id),
        Type      NVARCHAR(50)     NOT NULL,
        Payload   NVARCHAR(MAX)    NOT NULL,   -- JSON with actor, taskId, title etc.
        IsRead    BIT              NOT NULL DEFAULT 0,
        CreatedAt DATETIME2        NOT NULL DEFAULT GETUTCDATE()
    );

    CREATE INDEX IX_Notif_UserRead
        ON Notifications(UserId, IsRead);

    CREATE INDEX IX_Notif_CreatedAt
        ON Notifications(UserId, CreatedAt DESC);
END
