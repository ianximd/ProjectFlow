CREATE OR ALTER PROCEDURE dbo.usp_Comment_Resolve
    @CommentId UNIQUEIDENTIFIER,
    @ActorId   UNIQUEIDENTIFIER,
    @Resolved  BIT
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Comments WHERE Id = @CommentId AND DeletedAt IS NULL)
        THROW 51402, 'Comment not found', 1;

    UPDATE dbo.Comments
    SET ResolvedAt   = CASE WHEN @Resolved = 1 THEN GETUTCDATE() ELSE NULL END,
        ResolvedById = CASE WHEN @Resolved = 1 THEN @ActorId    ELSE NULL END,
        UpdatedAt    = GETUTCDATE()
    WHERE Id = @CommentId;

    SELECT
        c.Id, c.TaskId, c.AuthorId, c.ParentId, c.Body, c.IsEdited,
        c.AssignedToId, c.ResolvedAt, c.ResolvedById,
        c.CreatedAt, c.UpdatedAt,
        u.Name AS AuthorName, u.Email AS AuthorEmail, u.AvatarUrl AS AuthorAvatarUrl
    FROM dbo.Comments c
    JOIN dbo.Users u ON u.Id = c.AuthorId
    WHERE c.Id = @CommentId;
END;
