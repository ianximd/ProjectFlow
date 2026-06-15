import { describe, it, expect } from 'vitest';
import { buildTaskProjection, buildViewProjection, stripNavigation, stripWrites } from '../share.projection.js';

describe('stripWrites / stripNavigation', () => {
  it('stripWrites removes write/action affordances from a payload', () => {
    const out = stripWrites({ id: 't1', title: 'Hi', editUrl: '/x', actions: ['delete'], assigneeId: 'u1' });
    expect(out).not.toHaveProperty('editUrl');
    expect(out).not.toHaveProperty('actions');
    expect(out).not.toHaveProperty('assigneeId');
    expect(out.title).toBe('Hi');
  });
  it('stripNavigation removes parent/sibling/list/space links', () => {
    const out = stripNavigation({ id: 't1', listId: 'l1', parentTaskId: 'p1', spaceId: 's1', breadcrumb: ['a'] });
    expect(out).not.toHaveProperty('listId');
    expect(out).not.toHaveProperty('parentTaskId');
    expect(out).not.toHaveProperty('spaceId');
    expect(out).not.toHaveProperty('breadcrumb');
  });
});

describe('buildTaskProjection', () => {
  it('keeps content, strips writes + navigation (camelCase mapped row)', () => {
    const p = buildTaskProjection({
      id: 't1', title: 'Ship it', description: 'body', status: 'To Do', priority: 'HIGH',
      listId: 'l1', parentTaskId: 'p1', workspaceId: 'w1', assignees: [{ userId: 'u1' }], editUrl: '/x',
    } as any);
    expect(p.objectType).toBe('task');
    expect(p.objectId).toBe('t1');
    expect(p.title).toBe('Ship it');
    expect(p.data.description).toBe('body');
    expect(p.data.status).toBe('To Do');
    expect(p.data).not.toHaveProperty('listId');
    expect(p.data).not.toHaveProperty('parentTaskId');
    expect(p.data).not.toHaveProperty('workspaceId');
    expect(p.data).not.toHaveProperty('assignees');
    expect(p.data).not.toHaveProperty('editUrl');
  });
  it('tolerates a raw PascalCase row', () => {
    const p = buildTaskProjection({ Id: 't2', Title: 'Raw', Description: 'd', Status: 'Done', Priority: 'LOW', DueDate: '2026-07-01' } as any);
    expect(p.objectId).toBe('t2');
    expect(p.title).toBe('Raw');
    expect(p.data.status).toBe('Done');
  });
});

describe('buildViewProjection', () => {
  it('exposes only the view name + read-only config (camelCase, config already parsed)', () => {
    const p = buildViewProjection({ id: 'v1', name: 'My Board', type: 'board', config: { groupBy: 'status' }, workspaceId: 'w1' } as any);
    expect(p.objectType).toBe('view');
    expect(p.title).toBe('My Board');
    expect(p.data.type).toBe('board');
    expect((p.data.config as any).groupBy).toBe('status');
    expect(p.data).not.toHaveProperty('workspaceId');
  });
  it('tolerates a PascalCase row with a JSON-string Config', () => {
    const p = buildViewProjection({ Id: 'v2', Name: 'Raw View', Type: 'table', Config: '{"x":1}' } as any);
    expect(p.title).toBe('Raw View');
    expect((p.data.config as any).x).toBe(1);
  });
});
