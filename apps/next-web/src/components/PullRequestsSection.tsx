'use client';

import { useEffect, useState, useTransition } from 'react';
import { getPullRequests, getCommits } from '@/server/actions/git';
import type { GitPullRequest, GitCommit, GitProvider } from '@projectflow/types';
import styles from './pull-requests.module.css';
import { useTranslations } from 'next-intl';

const STATE_COLOR: Record<string, string> = {
  open:   '#27c93f',
  merged: '#6c63ff',
  closed: '#888',
};

// State labels are API-derived enum values — left as dynamic data (skipped per recipe).
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
  const t = useTranslations('PullRequests');
  const [prs, setPrs] = useState<GitPullRequest[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [, start] = useTransition();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!taskId) return;
    start(async () => {
      const [p, c] = await Promise.all([getPullRequests(taskId), getCommits(taskId)]);
      setPrs(p);
      setCommits(c);
      setLoaded(true);
    });
  }, [taskId]);

  // Hold the empty state until the first load resolves, so a task that has
  // links doesn't flash "No linked pull requests" for the round-trip.
  if (!loaded) {
    return <p className={styles.empty}>{t('loading')}</p>;
  }
  if (prs.length === 0 && commits.length === 0) {
    return <p className={styles.empty}>{t('noLinkedPrs')}</p>;
  }

  return (
    <div className={styles.container}>
      {prs.length > 0 && (
        <div className={styles.group}>
          <h4 className={styles.groupTitle}>{t('pullRequestsHeading')}</h4>
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
          <h4 className={styles.groupTitle}>{t('commitsHeading')}</h4>
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
