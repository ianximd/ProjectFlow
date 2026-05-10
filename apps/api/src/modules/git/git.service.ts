import { createHmac, timingSafeEqual } from 'crypto';
import type { GitConnection, GitPullRequest, GitCommit } from '@projectflow/types';
import { GitRepository } from './git.repository.js';

const ISSUE_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

function extractIssueKeys(text: string): string[] {
  return [...new Set([...text.matchAll(ISSUE_KEY_RE)].map((m) => m[1]))];
}

function verifyGitHubSignature(secret: string, payload: string, signature: string): boolean {
  if (!signature.startsWith('sha256=')) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function verifyGitLabToken(expectedToken: string, providedToken: string): boolean {
  if (!expectedToken || !providedToken) return false;
  try {
    // Pad to same length before comparison to prevent length leakage
    const a = Buffer.alloc(Math.max(expectedToken.length, providedToken.length));
    const b = Buffer.alloc(a.length);
    a.write(expectedToken);
    b.write(providedToken);
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export class GitService {
  constructor(private readonly repo: GitRepository) {}

  // ── Connections ──────────────────────────────────────────────────────────────

  listConnections(workspaceId: string): Promise<GitConnection[]> {
    return this.repo.listConnections(workspaceId);
  }

  createConnection(
    workspaceId: string,
    provider: string,
    repoOwner: string,
    repoName: string,
    webhookSecret: string,
    webhookId: string | null = null,
  ): Promise<GitConnection> {
    return this.repo.createConnection(workspaceId, provider, repoOwner, repoName, webhookSecret, webhookId);
  }

  deleteConnection(id: string): Promise<void> {
    return this.repo.deleteConnection(id);
  }

  // ── PR / Commit queries ──────────────────────────────────────────────────────

  listPRsByTask(taskId: string): Promise<GitPullRequest[]> {
    return this.repo.listPRsByTask(taskId);
  }

  listCommitsByTask(taskId: string): Promise<GitCommit[]> {
    return this.repo.listCommitsByTask(taskId);
  }

  // ── Webhook processing ───────────────────────────────────────────────────────

  async processGitHubWebhook(
    rawBody: string,
    signature: string,
    event: string,
  ): Promise<{ ok: boolean; error?: string }> {
    let payload: any;
    try { payload = JSON.parse(rawBody); } catch { return { ok: false, error: 'Invalid JSON' }; }

    const repo = payload.repository;
    if (!repo) return { ok: true };

    const repoOwner = repo.owner?.login ?? '';
    const repoName  = repo.name ?? '';

    const connection = await this.repo.getConnectionByRepo('github', repoOwner, repoName);
    if (!connection) return { ok: true }; // not configured — ignore

    if (!verifyGitHubSignature(connection.webhookSecret, rawBody, signature)) {
      return { ok: false, error: 'Invalid signature' };
    }

    if (event === 'pull_request') {
      await this.handleGitHubPR(payload, repoOwner, repoName);
    } else if (event === 'push') {
      await this.handleGitHubPush(payload, repoOwner, repoName);
    }

    return { ok: true };
  }

  async processGitLabWebhook(
    token: string,
    event: string,
    payload: any,
  ): Promise<{ ok: boolean; error?: string }> {
    const project = payload.project ?? payload.repository;
    if (!project) return { ok: true };

    const pathParts = (project.path_with_namespace ?? '').split('/');
    const repoOwner = pathParts[0] ?? '';
    const repoName  = pathParts.slice(1).join('/') || (project.name ?? '');

    const connection = await this.repo.getConnectionByRepo('gitlab', repoOwner, repoName);
    if (!connection) return { ok: true };

    if (!verifyGitLabToken(connection.webhookSecret, token)) {
      return { ok: false, error: 'Invalid token' };
    }

    if (event === 'Merge Request Hook') {
      await this.handleGitLabMR(payload, repoOwner, repoName);
    } else if (event === 'Push Hook' || event === 'Tag Push Hook') {
      await this.handleGitLabPush(payload, repoOwner, repoName);
    }

    return { ok: true };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async handleGitHubPR(payload: any, repoOwner: string, repoName: string): Promise<void> {
    const pr      = payload.pull_request;
    if (!pr) return;

    const rawState: string = pr.merged ? 'merged' : pr.state ?? 'open';
    const state    = ['open', 'closed', 'merged'].includes(rawState) ? rawState : 'open';
    const mergedAt = pr.merged_at ?? null;

    const candidates = new Set([
      ...extractIssueKeys(pr.title ?? ''),
      ...extractIssueKeys(pr.head?.ref ?? ''),
      ...extractIssueKeys(pr.body ?? ''),
    ]);

    for (const key of candidates) {
      const task = await this.repo.getTaskByIssueKey(key);
      if (!task) continue;
      await this.repo.upsertPR(
        task.id, 'github', repoOwner, repoName,
        pr.number, pr.title, pr.html_url,
        pr.user?.login ?? '', pr.user?.avatar_url ?? null,
        state, pr.head?.ref ?? '', pr.base?.ref ?? '', mergedAt,
      );
    }
  }

  private async handleGitHubPush(payload: any, repoOwner: string, repoName: string): Promise<void> {
    const commits: any[] = payload.commits ?? [];
    for (const commit of commits) {
      const keys = extractIssueKeys(commit.message ?? '');
      for (const key of keys) {
        const task = await this.repo.getTaskByIssueKey(key);
        if (!task) continue;
        await this.repo.upsertCommit(
          task.id, 'github', repoOwner, repoName,
          commit.id, commit.message, commit.url,
          commit.author?.name ?? commit.committer?.name ?? '',
          null,
          commit.timestamp,
        );
      }
    }
  }

  private async handleGitLabMR(payload: any, repoOwner: string, repoName: string): Promise<void> {
    const attrs = payload.object_attributes;
    if (!attrs) return;

    const rawState = attrs.state ?? 'opened';
    const state    = rawState === 'merged' ? 'merged' : rawState === 'closed' ? 'closed' : 'open';
    const mergedAt = attrs.merged_at ?? null;

    const candidates = new Set([
      ...extractIssueKeys(attrs.title ?? ''),
      ...extractIssueKeys(attrs.source_branch ?? ''),
      ...extractIssueKeys(attrs.description ?? ''),
    ]);

    for (const key of candidates) {
      const task = await this.repo.getTaskByIssueKey(key);
      if (!task) continue;
      await this.repo.upsertPR(
        task.id, 'gitlab', repoOwner, repoName,
        attrs.iid, attrs.title, attrs.url,
        payload.user?.username ?? '', payload.user?.avatar_url ?? null,
        state, attrs.source_branch ?? '', attrs.target_branch ?? '', mergedAt,
      );
    }
  }

  private async handleGitLabPush(payload: any, repoOwner: string, repoName: string): Promise<void> {
    const commits: any[] = payload.commits ?? [];
    for (const commit of commits) {
      const keys = extractIssueKeys(commit.message ?? '');
      for (const key of keys) {
        const task = await this.repo.getTaskByIssueKey(key);
        if (!task) continue;
        await this.repo.upsertCommit(
          task.id, 'gitlab', repoOwner, repoName,
          commit.id, commit.message, commit.url,
          commit.author?.name ?? '', null,
          commit.timestamp,
        );
      }
    }
  }
}
