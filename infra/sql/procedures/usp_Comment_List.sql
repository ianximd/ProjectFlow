CREATE OR ALTER PROCEDURE usp_Comment_List
    @TaskId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    -- Return top-level comments with author info and reaction counts
    SELECT
        c.Id,
        c.TaskId,
        c.AuthorId,
        c.ParentId,
        c.Body,
        c.IsEdited,
        c.AssignedToId,
        c.ResolvedAt,
        c.ResolvedById,
        c.CreatedAt,
        c.UpdatedAt,
        u.Name        AS AuthorName,
        u.Email       AS AuthorEmail,
        u.AvatarUrl   AS AuthorAvatarUrl,
        (
            SELECT r.Emoji, COUNT(*) AS Count
            FROM CommentReactions r
            WHERE r.CommentId = c.Id
            GROUP BY r.Emoji
            FOR JSON PATH
        ) AS ReactionsJson
    FROM Comments c
    JOIN Users u ON u.Id = c.AuthorId
    WHERE c.TaskId = @TaskId
      AND c.DeletedAt IS NULL
    ORDER BY c.CreatedAt ASC;
END;
