CREATE OR ALTER PROCEDURE dbo.usp_FormSubmission_ListByForm
    @FormId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.FormSubmissions
    WHERE FormId = @FormId
    ORDER BY SubmittedAt DESC;
END;
GO
