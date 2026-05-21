import 'server-only';
import { cache } from 'react';
import type { WorkLogListResult } from '@projectflow/types';
import { serverFetchBody } from '../api';

// GET /worklogs?taskId= returns a raw body { logs, totals } (NOT a { data }
// envelope) — the pre-migration client read `res.json()` straight into
// WorkLogListResult.
export const getWorkLogs = cache(async (taskId: string): Promise<WorkLogListResult> => {
  const body = await serverFetchBody<Partial<WorkLogListResult>>(
    `/worklogs?taskId=${encodeURIComponent(taskId)}`,
  );
  return { logs: body?.logs ?? [], totals: body?.totals ?? [] };
});
