CREATE OR ALTER PROCEDURE usp_Comment_Create
    @TaskId   UNIQUEIDENTIFIER,
    @AuthorId UNIQUEIDENTIFIER,
    @Body     NVARCHAR(MAX),
    @ParentId UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Id UNIQUEIDENTIFIER = NEWID();

    INSERT INTO Comments (Id, TaskId, AuthorId, ParentId, Body)
    VALUES (@Id, @TaskId, @AuthorId, @ParentId, @Body);

    SELECT
        c.Id,
        c.TaskId,
        c.AuthorId,
        c.ParentId,
        c.Body,
        c.IsEdited,
        c.CreatedAt,
        c.UpdatedAt,
        u.Name    AS AuthorName,
        u.Email   AS AuthorEmail,
        u.AvatarUrl AS AuthorAvatarUrl
    FROM Comments c
    JOIN Users u ON u.Id = c.AuthorId
    WHERE c.Id = @Id;
END;
