import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { GitConnection, GitPullRequest, GitCommit } from '@projectflow/types';

function mapConnection(row: any): GitConnection {
  return {
    id:          row.Id,
    workspaceId: row.WorkspaceId,
    provider:    row.Provider,
    repoOwner:   row.RepoOwner,
    repoName:    row.RepoName,
    webhookId:   row.WebhookId ?? null,
    createdAt:   String(row.CreatedAt),
  };
}

function mapPR(row: any): GitPullRequest {
  return {
    id:              row.Id,
    taskId:          row.TaskId,
    provider:        row.Provider,
    repoOwner:       row.RepoOwner,
    repoName:        row.RepoName,
    prNumber:        row.PrNumber,
    title:           row.Title,
    url:             row.Url,
    author:          row.Author,
    authorAvatarUrl: row.AuthorAvatarUrl ?? null,
    state:           row.State,
    headBranch:      row.HeadBranch,
    baseBranch:      row.BaseBranch,
    mergedAt:        row.MergedAt ? String(row.MergedAt) : null,
    createdAt:       String(row.CreatedAt),
    updatedAt:       String(row.UpdatedAt),
  };
}

function mapCommit(row: any): GitCommit {
  return {
    id:              row.Id,
    taskId:          row.TaskId,
    provider:        row.Provider,
    repoOwner:       row.RepoOwner,
    repoName:        row.RepoName,
    commitSha:       row.CommitSha,
    message:         row.Message,
    url:             row.Url,
    author:          row.Author,
    authorAvatarUrl: row.AuthorAvatarUrl ?? null,
    committedAt:     String(row.CommittedAt),
    createdAt:       String(row.CreatedAt),
  };
}

export class GitRepository {
  // ── Connections ──────────────────────────────────────────────────────────────

  async listConnections(workspaceId: string): Promise<GitConnection[]> {
    const rs = await execSpOne<any>('usp_GitConnection_List', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
    ]);
    return rs.map(mapConnection);
  }

  async createConnection(
    workspaceId: string,
    provider: string,
    repoOwner: string,
    repoName: string,
    webhookSecret: string,
    webhookId: string | null,
  ): Promise<GitConnection> {
    const rs = await execSpOne<any>('usp_GitConnection_Create', [
      { name: 'WorkspaceId',   type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'Provider',      type: sql.NVarChar(20),     value: provider },
      { name: 'RepoOwner',     type: sql.NVarChar(255),    value: repoOwner },
      { name: 'RepoName',      type: sql.NVarChar(255),    value: repoName },
      { name: 'WebhookSecret', type: sql.NVarChar(500),    value: webhookSecret },
      { name: 'WebhookId',     type: sql.NVarChar(100),    value: webhookId },
    ]);
    return mapConnection(rs[0]);
  }

  async deleteConnection(id: string): Promise<void> {
    await execSpOne<any>('usp_GitConnection_Delete', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
  }

  async getConnectionWorkspaceId(id: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_GitConnection_GetWorkspaceId', [
      { name: 'ConnectionId', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0]?.WorkspaceId ?? null;
  }

  async getConnectionByRepo(
    provider: string,
    repoOwner: string,
    repoName: string,
  ): Promise<(GitConnection & { webhookSecret: string }) | null> {
    const rs = await execSpOne<any>('usp_GitConnection_GetByRepo', [
      { name: 'Provider',  type: sql.NVarChar(20),  value: provider },
      { name: 'RepoOwner', type: sql.NVarChar(255), value: repoOwner },
      { name: 'RepoName',  type: sql.NVarChar(255), value: repoName },
    ]);
    if (!rs || !rs[0]) return null;
    return { ...mapConnection(rs[0]), webhookSecret: rs[0].WebhookSecret };
  }

  // ── Pull Requests ────────────────────────────────────────────────────────────

  async listPRsByTask(taskId: string): Promise<GitPullRequest[]> {
    const rs = await execSpOne<any>('usp_GitPR_ListByTask', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
    ]);
    return rs.map(mapPR);
  }

  async upsertPR(
    taskId: string,
    provider: string,
    repoOwner: string,
    repoName: string,
    prNumber: number,
    title: string,
    url: string,
    author: string,
    authorAvatarUrl: string | null,
    state: string,
    headBranch: string,
    baseBranch: string,
    mergedAt: string | null,
  ): Promise<GitPullRequest> {
    const rs = await execSpOne<any>('usp_GitPR_Upsert', [
      { name: 'TaskId',          type: sql.UniqueIdentifier, value: taskId },
      { name: 'Provider',        type: sql.NVarChar(20),     value: provider },
      { name: 'RepoOwner',       type: sql.NVarChar(255),    value: repoOwner },
      { name: 'RepoName',        type: sql.NVarChar(255),    value: repoName },
      { name: 'PrNumber',        type: sql.Int,              value: prNumber },
      { name: 'Title',           type: sql.NVarChar(500),    value: title },
      { name: 'Url',             type: sql.NVarChar(1000),   value: url },
      { name: 'Author',          type: sql.NVarChar(255),    value: author },
      { name: 'AuthorAvatarUrl', type: sql.NVarChar(1000),   value: authorAvatarUrl },
      { name: 'State',           type: sql.NVarChar(20),     value: state },
      { name: 'HeadBranch',      type: sql.NVarChar(500),    value: headBranch },
      { name: 'BaseBranch',      type: sql.NVarChar(500),    value: baseBranch },
      { name: 'MergedAt',        type: sql.DateTime2,        value: mergedAt ? new Date(mergedAt) : null },
    ]);
    return mapPR(rs[0]);
  }

  // ── Commits ──────────────────────────────────────────────────────────────────

  async listCommitsByTask(taskId: string): Promise<GitCommit[]> {
    const rs = await execSpOne<any>('usp_GitCommit_ListByTask', [
      { name: 'TaskId', type: sql.UniqueIdentifier, value: taskId },
    ]);
    return rs.map(mapCommit);
  }

  async upsertCommit(
    taskId: string,
    provider: string,
    repoOwner: string,
    repoName: string,
    commitSha: string,
    message: string,
    url: string,
    author: string,
    authorAvatarUrl: string | null,
    committedAt: string,
  ): Promise<GitCommit> {
    const rs = await execSpOne<any>('usp_GitCommit_Upsert', [
      { name: 'TaskId',          type: sql.UniqueIdentifier, value: taskId },
      { name: 'Provider',        type: sql.NVarChar(20),     value: provider },
      { name: 'RepoOwner',       type: sql.NVarChar(255),    value: repoOwner },
      { name: 'RepoName',        type: sql.NVarChar(255),    value: repoName },
      { name: 'CommitSha',       type: sql.NVarChar(40),     value: commitSha },
      { name: 'Message',         type: sql.NVarChar(2000),   value: message },
      { name: 'Url',             type: sql.NVarChar(1000),   value: url },
      { name: 'Author',          type: sql.NVarChar(255),    value: author },
      { name: 'AuthorAvatarUrl', type: sql.NVarChar(1000),   value: authorAvatarUrl },
      { name: 'CommittedAt',     type: sql.DateTime2,        value: new Date(committedAt) },
    ]);
    return mapCommit(rs[0]);
  }

  // ── Task lookup ──────────────────────────────────────────────────────────────

  async getTaskByIssueKey(issueKey: string): Promise<{ id: string; projectId: string; workspaceId: string } | null> {
    const rs = await execSpOne<any>('usp_Task_GetByIssueKey', [
      { name: 'IssueKey', type: sql.NVarChar(30), value: issueKey },
    ]);
    if (!rs || !rs[0]) return null;
    return { id: rs[0].Id, projectId: rs[0].ProjectId, workspaceId: rs[0].WorkspaceId };
  }
}
