-- Phase 8e: update editable goal fields (NULL @param = leave unchanged, except
-- @FolderId which is always assigned so a goal can be moved out of a folder by
-- passing NULL — callers that want "unchanged" must read+resend the current id).
CREATE OR ALTER PROCEDURE dbo.usp_Goal_Update
    @Id          UNIQUEIDENTIFIER,
    @Name        NVARCHAR(300) = NULL,
    @Description NVARCHAR(MAX) = NULL,
    @DueDate     DATE = NULL,
    @Status      NVARCHAR(12) = NULL,
    @FolderId    UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF @Status IS NOT NULL AND @Status NOT IN ('active','achieved','archived')
            THROW 52800, 'Invalid goal status', 1;
        UPDATE dbo.Goals
        SET Name        = COALESCE(@Name, Name),
            Description = COALESCE(@Description, Description),
            DueDate     = COALESCE(@DueDate, DueDate),
            Status      = COALESCE(@Status, Status),
            FolderId    = @FolderId,
            UpdatedAt   = SYSUTCDATETIME()
        WHERE Id = @Id AND DeletedAt IS NULL;
        SELECT * FROM dbo.Goals WHERE Id = @Id AND DeletedAt IS NULL;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
