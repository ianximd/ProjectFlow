import 'server-only';
import { cache } from 'react';
import type { IntegrationConnection } from '@projectflow/types';
import { serverFetch } from '../api';

// GET /integrations?workspaceId= returns the standard { data } envelope
// (the pre-migration client read `json.data ?? []`).
export const getIntegrations = cache(async (workspaceId: string): Promise<IntegrationConnection[]> => {
  return (await serverFetch<IntegrationConnection[]>(
    `/integrations?workspaceId=${encodeURIComponent(workspaceId)}`,
  )) ?? [];
});
