CREATE OR ALTER PROCEDURE usp_Comment_Delete
    @Id       UNIQUEIDENTIFIER,
    @AuthorId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE Comments
    SET    DeletedAt = GETUTCDATE(),
           UpdatedAt = GETUTCDATE()
    WHERE  Id       = @Id
      AND  AuthorId = @AuthorId
      AND  DeletedAt IS NULL;

    IF @@ROWCOUNT = 0
        RAISERROR('COMMENT_NOT_FOUND_OR_NOT_OWNER', 16, 1);
END;
