'use client';

import { useQuery } from '@tanstack/react-query';
import { useStore } from '@/store/useStore';
import type { GitPullRequest, GitCommit, GitProvider } from '@projectflow/types';
import styles from './pull-requests.module.css';

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function fetchPRs(taskId: string, token: string): Promise<GitPullRequest[]> {
  const res = await fetch(`/api/v1/git/pull-requests?taskId=${taskId}`, {
    headers: authHeaders(token), credentials: 'include',
  });
  if (!res.ok) return [];
  return (await res.json()).pullRequests;
}

async function fetchCommits(taskId: string, token: string): Promise<GitCommit[]> {
  const res = await fetch(`/api/v1/git/commits?taskId=${taskId}`, {
    headers: authHeaders(token), credentials: 'include',
  });
  if (!res.ok) return [];
  return (await res.json()).commits;
}

const STATE_COLOR: Record<string, string> = {
  open:   '#27c93f',
  merged: '#6c63ff',
  closed: '#888',
};

const STATE_LABEL: Record<string, string> = {
  open:   'Open',
  merged: 'Merged',
  closed: 'Closed',
};

function ProviderTag({ provider }: { provider: GitProvider }) {
  return (
    <span className={styles.providerTag} data-provider={provider}>
      {provider === 'github' ? 'GH' : 'GL'}
    </span>
  );
}

interface Props {
  taskId: string;
}

export function PullRequestsSection({ taskId }: Props) {
  const token = useStore(s => s.accessToken) ?? '';

  const { data: prs = []     } = useQuery({ queryKey: ['prs', taskId],     queryFn: () => fetchPRs(taskId, token),     enabled: !!token });
  const { data: commits = [] } = useQuery({ queryKey: ['commits', taskId], queryFn: () => fetchCommits(taskId, token), enabled: !!token });

  if (prs.length === 0 && commits.length === 0) {
    return <p className={styles.empty}>No linked pull requests or commits.</p>;
  }

  return (
    <div className={styles.container}>
      {prs.length > 0 && (
        <div className={styles.group}>
          <h4 className={styles.groupTitle}>Pull Requests</h4>
          <ul className={styles.list}>
            {prs.map((pr) => (
              <li key={pr.id} className={styles.item}>
                <ProviderTag provider={pr.provider} />
                <a href={pr.url} target="_blank" rel="noopener noreferrer" className={styles.prTitle}>
                  {pr.repoOwner}/{pr.repoName} #{pr.prNumber}: {pr.title}
                </a>
                <span
                  className={styles.stateBadge}
                  style={{ background: STATE_COLOR[pr.state] + '22', color: STATE_COLOR[pr.state] }}
                >
                  {STATE_LABEL[pr.state]}
                </span>
                <span className={styles.branch}>{pr.headBranch}</span>
                <span className={styles.author}>{pr.author}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {commits.length > 0 && (
        <div className={styles.group}>
          <h4 className={styles.groupTitle}>Commits</h4>
          <ul className={styles.list}>
            {commits.map((commit) => (
              <li key={commit.id} className={styles.item}>
                <ProviderTag provider={commit.provider} />
                <a href={commit.url} target="_blank" rel="noopener noreferrer" className={styles.commitMsg}>
                  {commit.message.split('\n')[0]}
                </a>
                <code className={styles.sha}>{commit.commitSha.slice(0, 7)}</code>
                <span className={styles.author}>{commit.author}</span>
                <span className={styles.date}>
                  {new Date(commit.committedAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
