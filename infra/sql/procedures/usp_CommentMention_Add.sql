CREATE OR ALTER PROCEDURE dbo.usp_CommentMention_Add
    @CommentId       UNIQUEIDENTIFIER,
    @MentionedUserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @WasInserted BIT = 0;

    -- Tenant safety: the mentioned user must be a member of the comment's
    -- task's workspace. Non-members are silently skipped (WasInserted = 0).
    IF EXISTS (
        SELECT 1
        FROM dbo.Comments c
        JOIN dbo.Tasks t  ON t.Id = c.TaskId
        JOIN dbo.WorkspaceMembers wm
             ON wm.WorkspaceId = t.WorkspaceId AND wm.UserId = @MentionedUserId
        WHERE c.Id = @CommentId AND c.DeletedAt IS NULL
    )
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM dbo.CommentMentions
            WHERE CommentId = @CommentId AND MentionedUserId = @MentionedUserId
        )
        BEGIN
            INSERT INTO dbo.CommentMentions (CommentId, MentionedUserId)
            VALUES (@CommentId, @MentionedUserId);
            SET @WasInserted = 1;
        END
    END

    SELECT @WasInserted AS WasInserted;
END;
