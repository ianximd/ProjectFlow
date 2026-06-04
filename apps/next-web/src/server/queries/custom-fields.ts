import 'server-only';
import { cache } from 'react';
import type { CustomField, EffectiveField } from '@projectflow/types';
import { serverFetch } from '../api';

// The custom-field API uses the standard { data } envelope, which serverFetch
// unwraps for us — so these return the inner array directly.

export const getCustomFields = cache(
  async (scopeType: 'SPACE' | 'FOLDER' | 'LIST', scopeId: string): Promise<CustomField[]> => {
    const data = await serverFetch<CustomField[]>(
      `/custom-fields?scopeType=${scopeType}&scopeId=${encodeURIComponent(scopeId)}`,
    );
    return data ?? [];
  },
);

export const getTaskFields = cache(async (taskId: string): Promise<EffectiveField[]> => {
  const data = await serverFetch<EffectiveField[]>(`/tasks/${encodeURIComponent(taskId)}/fields`);
  return data ?? [];
});
