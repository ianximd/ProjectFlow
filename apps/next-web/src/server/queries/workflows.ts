import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';

export interface WorkflowStatus {
  id:         string;
  name:       string;
  category:   string;
  color:      string;
  position:   number;
}

export interface WorkflowTransition {
  id:         string;
  fromStatus: string;
  toStatus:   string;
  name:       string | null;
}

export interface Workflow {
  id:          string;
  name:        string;
  statuses:    WorkflowStatus[];
  transitions: WorkflowTransition[];
}

// GET /workflows?projectId=... returns { data: workflow | null }
// The API's mapWorkflow already normalises to camelCase fields that the view reads.
export const getWorkflow = cache(async (projectId: string): Promise<Workflow | null> => {
  const data = await serverFetch<any>(`/workflows?projectId=${encodeURIComponent(projectId)}`);
  if (!data) return null;
  return {
    id:          String(data.id ?? ''),
    name:        String(data.name ?? ''),
    statuses:    Array.isArray(data.statuses)    ? data.statuses    : [],
    transitions: Array.isArray(data.transitions) ? data.transitions : [],
  };
});
