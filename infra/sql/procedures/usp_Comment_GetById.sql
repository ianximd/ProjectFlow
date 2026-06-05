CREATE OR ALTER PROCEDURE usp_Comment_GetById
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

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
        c.DeletedAt,
        c.CreatedAt,
        c.UpdatedAt,
        u.Name      AS AuthorName,
        u.Email     AS AuthorEmail,
        u.AvatarUrl AS AuthorAvatarUrl
    FROM Comments c
    JOIN Users u ON u.Id = c.AuthorId
    WHERE c.Id = @Id;
END;
