-- Single-row read for the audit-snapshot fetcher (Phase 6 W43 Option A
-- extension). Returns the canonical Sprint row by primary key.
CREATE OR ALTER PROCEDURE dbo.usp_Sprint_GetById
    @SprintId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1
           Id,
           ProjectId,
           Name,
           Goal,
           Status,
           StartDate,
           EndDate,
           CompletedAt,
           CreatedAt,
           UpdatedAt
    FROM   dbo.Sprints
    WHERE  Id = @SprintId;
END;
GO
