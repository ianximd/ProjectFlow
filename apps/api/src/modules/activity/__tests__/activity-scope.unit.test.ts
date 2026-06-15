import { describe, expect, it } from 'vitest';
import { buildAuditFilters, clampPage } from '../activity-scope.js';

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
});
