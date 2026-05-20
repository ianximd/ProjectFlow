import { describe, it, expect } from 'vitest';
import { normalizeWorkspace, normalizeProject } from '../normalize';

describe('normalizeWorkspace', () => {
  it('reads PascalCase fields', () => {
    expect(normalizeWorkspace({ Id: 'w1', Name: 'Acme' })).toEqual({ id: 'w1', name: 'Acme' });
  });
  it('reads camelCase fields', () => {
    expect(normalizeWorkspace({ id: 'w2', name: 'Beta' })).toEqual({ id: 'w2', name: 'Beta' });
  });
});

describe('normalizeProject', () => {
  it('maps PascalCase API rows to a stable camelCase shape', () => {
    expect(
      normalizeProject({
        Id: 'p1', Name: 'Web', Key: 'WEB', Description: 'site',
        Type: 'KANBAN', Status: 'ACTIVE', CreatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toEqual({
      id: 'p1', name: 'Web', key: 'WEB', description: 'site',
      type: 'KANBAN', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z',
    });
  });
  it('maps camelCase rows too', () => {
    const p = normalizeProject({ id: 'p2', name: 'App', key: 'APP', type: 'SCRUM', status: 'ARCHIVED' });
    expect(p).toMatchObject({ id: 'p2', name: 'App', key: 'APP', type: 'SCRUM', status: 'ARCHIVED' });
  });
  it('applies safe defaults for missing fields', () => {
    const p = normalizeProject({ Id: 'p3' });
    expect(p).toEqual({
      id: 'p3', name: '(unnamed)', key: '—', description: null,
      type: 'KANBAN', status: 'ACTIVE', createdAt: null,
    });
  });
  it('coerces empty/blank description and createdAt to null', () => {
    const p = normalizeProject({ Id: 'p4', Description: '', CreatedAt: '' });
    expect(p.description).toBeNull();
    expect(p.createdAt).toBeNull();
  });
});
