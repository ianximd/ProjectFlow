'use server';
import 'server-only';
import { serverFetch } from '../api';

export interface AskCitation {
  objectType: string;
  objectId: string;
}

export interface AskResult {
  answer: string;
  citations: AskCitation[];
}

/**
 * Ask AI a question over the workspace's accessible content (Phase 11b).
 * Delegates to POST /ai/ask, which gates on `ai.use` and returns citations that
 * resolve only to objects the caller can VIEW. Throws ApiError on failure
 * (e.g. 403 for a caller without ai.use) — the panel catches and shows a notice.
 */
export async function askAi(workspaceId: string, question: string): Promise<AskResult> {
  return serverFetch<AskResult>('/ai/ask', {
    method: 'POST',
    body: JSON.stringify({ workspaceId, question }),
  });
}
