CREATE OR ALTER PROCEDURE dbo.usp_FormSubmission_Create
    @Id            UNIQUEIDENTIFIER,
    @FormId        UNIQUEIDENTIFIER,
    @Answers       NVARCHAR(MAX),
    @CreatedTaskId UNIQUEIDENTIFIER = NULL,
    @SubmittedById UNIQUEIDENTIFIER = NULL   -- NULL for anonymous public submits
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        INSERT INTO dbo.FormSubmissions (Id, FormId, Answers, CreatedTaskId, SubmittedById)
        VALUES (@Id, @FormId, @Answers, @CreatedTaskId, @SubmittedById);

        SELECT * FROM dbo.FormSubmissions WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
GO
