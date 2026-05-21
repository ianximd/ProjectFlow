'use server';

import { unstable_rethrow } from 'next/navigation';
import { requireSession } from '../session';
import { serverFetchBody } from '../api';
import type { GitPullRequest, GitCommit } from '@projectflow/types';

// GET /git/pull-requests?taskId= and /git/commits?taskId= return raw bodies
// ({ pullRequests } / { commits }), not the { data } envelope. The section is
// read-only and treats any backend error as "no links" — but auth redirects
// (thrown by serverFetchBody on 401) must still propagate.

export async function getPullRequests(taskId: string): Promise<GitPullRequest[]> {
  await requireSession();
  try {
    const body = await serverFetchBody<{ pullRequests?: GitPullRequest[] }>(
      `/git/pull-requests?taskId=${encodeURIComponent(taskId)}`,
    );
    return body?.pullRequests ?? [];
  } catch (e) {
    unstable_rethrow(e);
    return [];
  }
}

export async function getCommits(taskId: string): Promise<GitCommit[]> {
  await requireSession();
  try {
    const body = await serverFetchBody<{ commits?: GitCommit[] }>(
      `/git/commits?taskId=${encodeURIComponent(taskId)}`,
    );
    return body?.commits ?? [];
  } catch (e) {
    unstable_rethrow(e);
    return [];
  }
}
