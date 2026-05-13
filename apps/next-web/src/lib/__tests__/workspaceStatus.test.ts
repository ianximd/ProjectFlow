/**
 * Priority for getWorkspaceStatus:
 *   1. Archived   (deletedAt set) — wins over everything
 *   2. Suspended  (red)
 *   3. Frozen     (orange)
 *   4. Trial      (blue)
 *   5. Active     (green) — fallback
 */

import { describe, expect, it } from 'vitest';
import { getWorkspaceStatus } from '../workspaceStatus';

describe('getWorkspaceStatus', () => {
  it('returns Active for the happy path (status=ACTIVE, not deleted)', () => {
    expect(getWorkspaceStatus({ status: 'ACTIVE', deletedAt: null }))
      .toEqual({ label: 'Active', tone: 'green' });
  });

  it('returns Archived when deletedAt is set, regardless of status', () => {
    expect(getWorkspaceStatus({ status: 'ACTIVE', deletedAt: '2026-05-13T00:00:00Z' }))
      .toEqual({ label: 'Archived', tone: 'red' });
    expect(getWorkspaceStatus({ status: 'TRIAL', deletedAt: '2026-05-13T00:00:00Z' }))
      .toEqual({ label: 'Archived', tone: 'red' });
    expect(getWorkspaceStatus({ status: 'FROZEN', deletedAt: '2026-05-13T00:00:00Z' }))
      .toEqual({ label: 'Archived', tone: 'red' });
  });

  it('returns Suspended for SUSPENDED status', () => {
    expect(getWorkspaceStatus({ status: 'SUSPENDED', deletedAt: null }))
      .toEqual({ label: 'Suspended', tone: 'red' });
  });

  it('returns Frozen for FROZEN status', () => {
    expect(getWorkspaceStatus({ status: 'FROZEN', deletedAt: null }))
      .toEqual({ label: 'Frozen', tone: 'orange' });
  });

  it('returns Trial for TRIAL status', () => {
    expect(getWorkspaceStatus({ status: 'TRIAL', deletedAt: null }))
      .toEqual({ label: 'Trial', tone: 'blue' });
  });

  it('falls back to Active for an unknown future status string', () => {
    // Defensive: if the API adds a new enum value before the frontend
    // is updated, default to Active rather than crash.
    expect(getWorkspaceStatus({ status: 'BETA_TESTING' as any, deletedAt: null }))
      .toEqual({ label: 'Active', tone: 'green' });
  });
});
