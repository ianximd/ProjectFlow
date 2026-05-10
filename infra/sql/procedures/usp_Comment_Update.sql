CREATE OR ALTER PROCEDURE usp_Comment_Update
    @Id       UNIQUEIDENTIFIER,
    @AuthorId UNIQUEIDENTIFIER,
    @Body     NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        UPDATE Comments
        SET    Body      = @Body,
               IsEdited  = 1,
               UpdatedAt = GETUTCDATE()
        WHERE  Id        = @Id
          AND  AuthorId  = @AuthorId
          AND  DeletedAt IS NULL;

        IF @@ROWCOUNT = 0
        BEGIN
            ROLLBACK TRANSACTION;
            RAISERROR('COMMENT_NOT_FOUND_OR_NOT_OWNER', 16, 1);
            RETURN;
        END;

        SELECT
            c.Id,
            c.TaskId,
            c.AuthorId,
            c.ParentId,
            c.Body,
            c.IsEdited,
            c.CreatedAt,
            c.UpdatedAt,
            u.Name      AS AuthorName,
            u.Email     AS AuthorEmail,
            u.AvatarUrl AS AuthorAvatarUrl
        FROM Comments c
        JOIN Users u ON u.Id = c.AuthorId
        WHERE c.Id = @Id;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
