CREATE OR ALTER PROCEDURE usp_Sprint_Create
    @ProjectId UNIQUEIDENTIFIER,
    @Name      NVARCHAR(255),
    @Goal      NVARCHAR(MAX) = NULL,
    @StartDate DATETIME2    = NULL,
    @EndDate   DATETIME2    = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @NewId UNIQUEIDENTIFIER = NEWID();

    INSERT INTO Sprints (Id, ProjectId, Name, Goal, Status, StartDate, EndDate)
    VALUES (@NewId, @ProjectId, @Name, @Goal, 'PLANNED', @StartDate, @EndDate);

    SELECT * FROM Sprints WHERE Id = @NewId;
END;
