import { describe, it, expect } from 'vitest';
import { APP_REGISTRY, resolveAppEnabled, resolveAllApps, type OverrideRow } from '../app-registry.js';

// Depth order produced by usp_AppsEnabled_ListForScope: workspace=0, space=1,
// folders by LEN(Path), list=9999. Higher Depth = more specific = wins.
const ws    = (key: string, enabled: boolean): OverrideRow => ({ appKey: key as any, enabled, scopeType: 'workspace', scopeId: null, depth: 0 });
const space = (key: string, enabled: boolean): OverrideRow => ({ appKey: key as any, enabled, scopeType: 'space', scopeId: 's', depth: 1 });
const list  = (key: string, enabled: boolean): OverrideRow => ({ appKey: key as any, enabled, scopeType: 'list', scopeId: 'l', depth: 9999 });

describe('resolveAppEnabled — most-specific-wins', () => {
  it('falls back to the registry default with no overrides', () => {
    expect(resolveAppEnabled('time_tracking', []).enabled).toBe(true);
    expect(resolveAppEnabled('time_tracking', []).overridden).toBe(false);
    expect(resolveAppEnabled('time_tracking', []).source).toBeNull();
  });

  it('a workspace override beats the registry default', () => {
    const r = resolveAppEnabled('time_tracking', [ws('time_tracking', false)]);
    expect(r.enabled).toBe(false);
    expect(r.overridden).toBe(true);
    expect(r.source).toBe('workspace');
  });

  it('a space override beats a workspace override', () => {
    const r = resolveAppEnabled('time_tracking', [ws('time_tracking', true), space('time_tracking', false)]);
    expect(r.enabled).toBe(false);
    expect(r.source).toBe('space');
  });

  it('a list override beats space + workspace (deepest wins)', () => {
    const r = resolveAppEnabled('time_tracking', [
      ws('time_tracking', false), space('time_tracking', false), list('time_tracking', true),
    ]);
    expect(r.enabled).toBe(true);
    expect(r.source).toBe('list');
  });

  it('ignores overrides for other app keys', () => {
    const r = resolveAppEnabled('time_tracking', [space('multiple_assignees', false)]);
    expect(r.enabled).toBe(true);
    expect(r.overridden).toBe(false);
  });

  it('an unknown app key is treated as disabled (fail-closed)', () => {
    expect(resolveAppEnabled('not_a_real_app' as any, []).enabled).toBe(false);
  });
});

describe('resolveAllApps', () => {
  it('returns every registry app with its resolved state', () => {
    const all = resolveAllApps([space('time_tracking', false)]);
    expect(all).toHaveLength(APP_REGISTRY.length);
    const tt = all.find((a) => a.key === 'time_tracking')!;
    expect(tt.enabled).toBe(false);
    expect(tt.source).toBe('space');
    const na = all.find((a) => a.key === 'multiple_assignees')!;
    expect(na.overridden).toBe(false);
  });
});
