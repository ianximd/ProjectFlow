CREATE OR ALTER PROCEDURE usp_Comment_React
    @CommentId UNIQUEIDENTIFIER,
    @UserId    UNIQUEIDENTIFIER,
    @Emoji     NVARCHAR(20)
AS
BEGIN
    SET NOCOUNT ON;

    -- Toggle: insert if absent, delete if present
    IF EXISTS (
        SELECT 1 FROM CommentReactions
        WHERE CommentId = @CommentId AND UserId = @UserId AND Emoji = @Emoji
    )
    BEGIN
        DELETE FROM CommentReactions
        WHERE CommentId = @CommentId AND UserId = @UserId AND Emoji = @Emoji;
    END
    ELSE
    BEGIN
        INSERT INTO CommentReactions (CommentId, UserId, Emoji)
        VALUES (@CommentId, @UserId, @Emoji);
    END;

    -- Return updated reaction summary for this comment
    SELECT Emoji, COUNT(*) AS [Count]
    FROM   CommentReactions
    WHERE  CommentId = @CommentId
    GROUP BY Emoji;
END;
