/**
 * Compute the headline workspace-status label + tone the admin panel
 * shows in its Status column (Phase 6 W43). Pure function — no I/O.
 *
 * Priority:
 *   1. Archived         (red)    — `deletedAt` set. Wins regardless of
 *                                  Status because a soft-deleted
 *                                  workspace can't be operated on.
 *   2. Suspended        (red)    — admin pulled the workspace for
 *                                  compliance/security; intentionally
 *                                  visually distinct from Frozen.
 *   3. Frozen           (orange) — temporary admin intervention; data
 *                                  intact, writes can be refused by a
 *                                  future guard middleware.
 *   4. Trial            (blue)   — subscription state.
 *   5. Active           (green)  — happy path.
 */

import type { WorkspaceStatus } from '@projectflow/types';

export type WorkspaceStatusLabel =
  | 'Archived'
  | 'Suspended'
  | 'Frozen'
  | 'Trial'
  | 'Active';

export type StatusTone = 'red' | 'orange' | 'yellow' | 'blue' | 'green';

export interface WorkspaceStatusInput {
  status:    WorkspaceStatus | string;  // permissive — DB string survives a type drift
  deletedAt: string | null;
}

export interface WorkspaceStatusResult {
  label: WorkspaceStatusLabel;
  tone:  StatusTone;
}

export function getWorkspaceStatus(w: WorkspaceStatusInput): WorkspaceStatusResult {
  if (w.deletedAt) {
    return { label: 'Archived',  tone: 'red'    };
  }
  switch (w.status) {
    case 'SUSPENDED': return { label: 'Suspended', tone: 'red'    };
    case 'FROZEN':    return { label: 'Frozen',    tone: 'orange' };
    case 'TRIAL':     return { label: 'Trial',     tone: 'blue'   };
    case 'ACTIVE':
    default:          return { label: 'Active',    tone: 'green'  };
  }
}

/**
 * Valid status values an admin can SET. Excludes the implicit
 * "Archived" — that one is governed by soft-delete (DELETE
 * /workspaces/:id) and is not a Status enum value.
 */
export const SETTABLE_STATUSES: ReadonlyArray<WorkspaceStatus> = [
  'ACTIVE', 'TRIAL', 'FROZEN', 'SUSPENDED',
];
