-- Migration 0012: GitHub / GitLab integration tables

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'GitConnections')
CREATE TABLE dbo.GitConnections (
  Id            UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  WorkspaceId   UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Workspaces(Id) ON DELETE CASCADE,
  Provider      NVARCHAR(20)     NOT NULL,
  RepoOwner     NVARCHAR(255)    NOT NULL,
  RepoName      NVARCHAR(255)    NOT NULL,
  WebhookSecret NVARCHAR(500)    NOT NULL,
  WebhookId     NVARCHAR(100)    NULL,
  CreatedAt     DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_GitConn_WsProviderRepo UNIQUE (WorkspaceId, Provider, RepoOwner, RepoName),
  CONSTRAINT CK_GitConn_Provider CHECK (Provider IN ('github', 'gitlab'))
);

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'GitPullRequests')
CREATE TABLE dbo.GitPullRequests (
  Id              UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  TaskId          UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Tasks(Id) ON DELETE CASCADE,
  Provider        NVARCHAR(20)     NOT NULL,
  RepoOwner       NVARCHAR(255)    NOT NULL,
  RepoName        NVARCHAR(255)    NOT NULL,
  PrNumber        INT              NOT NULL,
  Title           NVARCHAR(500)    NOT NULL,
  Url             NVARCHAR(1000)   NOT NULL,
  Author          NVARCHAR(255)    NOT NULL,
  AuthorAvatarUrl NVARCHAR(1000)   NULL,
  State           NVARCHAR(20)     NOT NULL DEFAULT 'open',
  HeadBranch      NVARCHAR(500)    NOT NULL,
  BaseBranch      NVARCHAR(500)    NOT NULL,
  MergedAt        DATETIME2        NULL,
  CreatedAt       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_GitPR_TaskRepo UNIQUE (TaskId, Provider, RepoOwner, RepoName, PrNumber),
  CONSTRAINT CK_GitPR_State CHECK (State IN ('open', 'closed', 'merged'))
);

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'GitCommits')
CREATE TABLE dbo.GitCommits (
  Id              UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  TaskId          UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Tasks(Id) ON DELETE CASCADE,
  Provider        NVARCHAR(20)     NOT NULL,
  RepoOwner       NVARCHAR(255)    NOT NULL,
  RepoName        NVARCHAR(255)    NOT NULL,
  CommitSha       NVARCHAR(40)     NOT NULL,
  Message         NVARCHAR(2000)   NOT NULL,
  Url             NVARCHAR(1000)   NOT NULL,
  Author          NVARCHAR(255)    NOT NULL,
  AuthorAvatarUrl NVARCHAR(1000)   NULL,
  CommittedAt     DATETIME2        NOT NULL,
  CreatedAt       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_GitCommit_TaskRepo UNIQUE (TaskId, Provider, RepoOwner, RepoName, CommitSha)
);
