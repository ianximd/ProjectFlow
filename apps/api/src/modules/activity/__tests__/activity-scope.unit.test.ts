import { describe, expect, it } from 'vitest';
import { buildAuditFilters, clampPage, clampPageSize, nz } from '../activity-scope.js';

describe('clampPage', () => {
  it('returns 1 for undefined', () => {
    expect(clampPage(undefined)).toBe(1);
  });

  it('returns 1 for 0', () => {
    expect(clampPage(0)).toBe(1);
  });

  it('returns 1 for negative numbers', () => {
    expect(clampPage(-5)).toBe(1);
  });

  it('returns the value when >= 1', () => {
    expect(clampPage(3)).toBe(3);
  });
});

describe('clampPageSize', () => {
  it('defaults to 50 for undefined', () => {
    expect(clampPageSize(undefined)).toBe(50);
  });

  it('defaults to 50 for 0', () => {
    expect(clampPageSize(0)).toBe(50);
  });

  it('caps at 200', () => {
    expect(clampPageSize(9999)).toBe(200);
  });

  it('passes through values in range', () => {
    expect(clampPageSize(75)).toBe(75);
  });
});

describe('nz (string normalizer)', () => {
  it('returns undefined for null', () => {
    expect(nz(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(nz(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(nz('')).toBeUndefined();
  });

  it('returns undefined for whitespace-only string', () => {
    expect(nz('   ')).toBeUndefined();
  });

  it('returns trimmed value for non-blank string', () => {
    expect(nz('  user-42  ')).toBe('user-42');
  });

  it('returns plain value unchanged', () => {
    expect(nz('CREATE')).toBe('CREATE');
  });
});

describe('buildAuditFilters', () => {
  it('passes workspaceId through from the scope node', () => {
    const filters = buildAuditFilters(
      { workspaceId: 'ws-1', scopePath: '/ws-1/' },
      { scopeType: 'EVERYTHING', scopeId: null },
      {},
    );
    expect(filters.workspaceId).toBe('ws-1');
  });

  it('sets resourceId to scopeId for LIST scope', () => {
    const filters = buildAuditFilters(
      { workspaceId: 'ws-1', scopePath: '/ws-1/sp-1/fo-1/li-1/' },
      { scopeType: 'LIST', scopeId: 'li-1' },
      {},
    );
    expect(filters.resourceId).toBe('li-1');
  });

  it('maps actor filter to userId', () => {
    const filters = buildAuditFilters(
      { workspaceId: 'ws-1', scopePath: '/ws-1/' },
      { scopeType: 'EVERYTHING', scopeId: null },
      { actor: 'user-42' },
    );
    expect(filters.userId).toBe('user-42');
  });

  it('passes action and resource filters through', () => {
    const filters = buildAuditFilters(
      { workspaceId: 'ws-1', scopePath: '/ws-1/' },
      { scopeType: 'EVERYTHING', scopeId: null },
      { action: 'CREATE', resource: 'Task' },
    );
    expect(filters.action).toBe('CREATE');
    expect(filters.resource).toBe('Task');
  });

  it('clamps page to 1 minimum', () => {
    const filters = buildAuditFilters(
      { workspaceId: 'ws-1', scopePath: '/ws-1/' },
      { scopeType: 'EVERYTHING', scopeId: null },
      { page: -1, pageSize: 10 },
    );
    expect(filters.page).toBe(1);
    expect(filters.pageSize).toBe(10);
  });

  it('empty-string actor/action are treated as no filter (undefined)', () => {
    const filters = buildAuditFilters(
      { workspaceId: 'ws-1', scopePath: '/ws-1/' },
      { scopeType: 'EVERYTHING', scopeId: null },
      { actor: '', action: null as unknown as undefined },
    );
    expect(filters.userId).toBeUndefined();
    expect(filters.action).toBeUndefined();
    expect(filters.workspaceId).toBe('ws-1');
    expect(filters.page).toBe(1);
    expect(filters.pageSize).toBe(50);
  });

  it('defaults page to 1 and pageSize to 50 when not provided', () => {
    const filters = buildAuditFilters(
      { workspaceId: 'ws-1', scopePath: '/ws-1/' },
      { scopeType: 'EVERYTHING', scopeId: null },
      {},
    );
    expect(filters.page).toBe(1);
    expect(filters.pageSize).toBe(50);
  });

  it('caps pageSize at 200', () => {
    const filters = buildAuditFilters(
      { workspaceId: 'ws-1', scopePath: '/ws-1/' },
      { scopeType: 'EVERYTHING', scopeId: null },
      { pageSize: 9999 },
    );
    expect(filters.pageSize).toBe(200);
  });
});
