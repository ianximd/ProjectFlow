import { describe, it, expect, vi, beforeEach } from 'vitest';

const burndown = vi.fn(async () => ({ totalPoints: 14, points: [] }));
const velocity = vi.fn(async () => [{ sprintId: 's1', committedPoints: 14, completedPoints: 12 }]);
const burnup = vi.fn(async () => ({ totalScopePoints: 14, completedPoints: 12, points: [] }));
const cumulativeFlow = vi.fn(async () => [{ date: '2026-06-01', status: 'TODO', issueCount: 3 }]);
const leadCycleTime = vi.fn(async () => ({ tasks: [], avgLeadTimeSeconds: 100 }));
const sprintSummary = vi.fn(async () => ({ sprintId: 's1', totalIssues: 5 }));
const portfolio = vi.fn(async () => [{ scopeId: 'f1', progressPct: 70, onTrack: true }]);
// NB: delegate via methods (not class fields) so the const vi.fn's are read
// lazily at call-time — class-field initializers run at `new` (module-load,
// after vi.mock hoisting) and would hit the const's temporal dead zone.
vi.mock('../../reports/reports.service.js', () => ({
  ReportsService: class {
    burndown(...a: any[]) { return burndown(...a as []); }
    velocity(...a: any[]) { return velocity(...a as []); }
    burnup(...a: any[]) { return burnup(...a as []); }
    cumulativeFlow(...a: any[]) { return cumulativeFlow(...a as []); }
    leadCycleTime(...a: any[]) { return leadCycleTime(...a as []); }
    sprintSummary(...a: any[]) { return sprintSummary(...a as []); }
    portfolio(...a: any[]) { return portfolio(...a as []); }
  },
}));
const getRollup = vi.fn(async () => ({ rollupLoggedSeconds: 3600 }));
vi.mock('../../worklogs/worklog.service.js', () => ({ WorkLogService: class { getRollup(...a: any[]) { return getRollup(...a as []); } } }));
// Workspace resolvers → return the dashboard's workspace so the guard PASSES.
vi.mock('../../sprints/sprint.service.js', () => ({ sprintService: { getSprintWorkspaceId: vi.fn(async () => 'ws1') } }));
vi.mock('../../projects/project.service.js', () => ({ projectService: { getById: vi.fn(async () => ({ WorkspaceId: 'ws1' })) } }));
vi.mock('../../customfields/customfield.repository.js', () => ({ CustomFieldRepository: class { getScopeNode = vi.fn(async () => ({ workspaceId: 'ws1', scopePath: '' })); } }));
// wsForTask uses TaskRepository.getWorkspaceId → return ws1 so the guard passes.
vi.mock('../../tasks/task.repository.js', () => ({ TaskRepository: class { getWorkspaceId = vi.fn(async () => 'ws1'); } }));

import { CardService } from '../card.service.js';

const dashboard = { id: 'dash1', workspaceId: 'ws1', scopeType: 'workspace', scopeId: null } as any;
const userId = 'u1';
const card = (type: string, reportParams: any) => ({ id: 'c1', type, title: null, config: { reportParams }, layout: { x:0,y:0,w:1,h:1 }, position: 0 }) as any;

beforeEach(() => vi.clearAllMocks());
const svc = new CardService();

describe('card.service — 9b analytics/entity card dispatch (guard passes)', () => {
  it('burndown → ReportsService.burndown(sprintId)', async () => {
    await svc.resolve(card('burndown', { sprintId: 's1' }), dashboard, userId);
    expect(burndown).toHaveBeenCalledWith('s1');
  });
  it('velocity → velocity(projectId, numSprints)', async () => {
    await svc.resolve(card('velocity', { projectId: 'p1', numSprints: 6 }), dashboard, userId);
    expect(velocity).toHaveBeenCalledWith('p1', 6);
  });
  it('burnup → burnup(sprintId)', async () => {
    await svc.resolve(card('burnup', { sprintId: 's1' }), dashboard, userId);
    expect(burnup).toHaveBeenCalledWith('s1');
  });
  it('cumulative_flow → cumulativeFlow(scopeType, scopeId, weeks)', async () => {
    await svc.resolve(card('cumulative_flow', { scopeType: 'space', scopeId: 'sp1', weeks: 8 }), dashboard, userId);
    expect(cumulativeFlow).toHaveBeenCalledWith('space', 'sp1', 8);
  });
  it('lead_cycle_time → leadCycleTime(scopeType, scopeId, weeks)', async () => {
    await svc.resolve(card('lead_cycle_time', { scopeType: 'space', scopeId: 'sp1', weeks: 12 }), dashboard, userId);
    expect(leadCycleTime).toHaveBeenCalledWith('space', 'sp1', 12);
  });
  it('sprint_summary → sprintSummary(sprintId)', async () => {
    await svc.resolve(card('sprint_summary', { sprintId: 's1' }), dashboard, userId);
    expect(sprintSummary).toHaveBeenCalledWith('s1');
  });
  it('portfolio → portfolio(scopeType, scopeIds)', async () => {
    await svc.resolve(card('portfolio', { scopeType: 'folder', scopeIds: ['f1', 'f2'] }), dashboard, userId);
    expect(portfolio).toHaveBeenCalledWith('folder', ['f1', 'f2']);
  });
  it('timesheet → worklog getRollup', async () => {
    await svc.resolve(card('timesheet', { taskId: 't1' }), dashboard, userId);
    expect(getRollup).toHaveBeenCalled();
  });
});

describe('card.service — 9b cross-tenant guard', () => {
  it('a burndown card whose sprint belongs to ANOTHER workspace returns pending and does NOT call the report', async () => {
    const foreignDash = { ...dashboard, workspaceId: 'ws-OTHER' } as any;  // sprint resolves to ws1 ≠ ws-OTHER
    const out = await svc.resolve(card('burndown', { sprintId: 's1' }), foreignDash, userId);
    expect(burndown).not.toHaveBeenCalled();
    expect(out.data).toBeNull();
  });
});
