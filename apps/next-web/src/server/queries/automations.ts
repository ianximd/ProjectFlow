import 'server-only';
import { cache } from 'react';
import { serverFetchBody } from '../api';
import type { AutomationTemplate, AutomationUsage } from '@projectflow/types';

// GET /automations?projectId= returns { rules: [...] } — not the standard { data } envelope.
// The API's parseRow already normalises DB PascalCase columns to camelCase fields.

export interface Automation {
  id:             string;
  name:           string;
  isEnabled:      boolean;
  trigger:        any;
  conditions:     any[];
  actions:        any[];
  executionCount: number;
  lastExecutedAt: string | null;
  [k: string]:    unknown;
}

export const getAutomations = cache(async (projectId: string): Promise<Automation[]> => {
  const body = await serverFetchBody<{ rules: any[] }>(
    `/automations?projectId=${encodeURIComponent(projectId)}`,
  );
  return (body?.rules ?? []).map((r) => ({
    ...r,
    id:             String(r?.id ?? ''),
    name:           String(r?.name ?? ''),
    isEnabled:      Boolean(r?.isEnabled),
    trigger:        r?.trigger ?? null,
    conditions:     Array.isArray(r?.conditions) ? r.conditions : [],
    actions:        Array.isArray(r?.actions)    ? r.actions    : [],
    executionCount: Number(r?.executionCount ?? 0),
    lastExecutedAt: r?.lastExecutedAt ?? null,
  }));
});

export const getAutomationTemplates = cache(async (): Promise<AutomationTemplate[]> => {
  const body = await serverFetchBody<{ templates: AutomationTemplate[] }>('/automations/templates');
  return body?.templates ?? [];
});

export const getAutomationUsage = cache(async (workspaceId: string): Promise<AutomationUsage | null> => {
  if (!workspaceId) return null;
  const body = await serverFetchBody<{ usage: AutomationUsage }>(
    `/automations/usage?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  return body?.usage ?? null;
});
