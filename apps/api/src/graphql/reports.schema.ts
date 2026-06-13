import { builder } from './builder.js';
import { ReportsService } from '../modules/reports/reports.service.js';
import { projectService } from '../modules/projects/project.service.js';
import { sprintService } from '../modules/sprints/sprint.service.js';
import { CustomFieldRepository } from '../modules/customfields/customfield.repository.js';
import { requireWorkspacePermission, notFound } from './authz.js';
import type {
  BurndownReport, BurndownPoint, VelocityEntry, SprintSummaryReport, SprintStatusBreakdown,
  WorkloadEntry, CreatedVsResolvedEntry, BurnupReport, BurnupPoint, CumulativeFlowEntry,
  LeadCycleTimeReport, LeadCycleTimeEntry, PortfolioEntry,
} from '@projectflow/types';

const svc = new ReportsService();
const cfRepo = new CustomFieldRepository();

// Resolve the report's owning workspace, then gate on report.read.
async function workspaceForSprint(sprintId: string): Promise<string | null> {
  return sprintService.getSprintWorkspaceId(sprintId);
}
async function workspaceForProject(projectId: string): Promise<string | null> {
  const project = await projectService.getById(projectId);
  return (project as any)?.WorkspaceId ?? null;   // SP returns PascalCase (SELECT *)
}
async function workspaceForScope(scopeType: string, scopeId: string): Promise<string | null> {
  const node = await cfRepo.getScopeNode(scopeType.toUpperCase() as any, scopeId);
  return node?.workspaceId ?? null;
}

export function registerReportsGraphql(): void {
  // ── Object refs ──
  const BurndownPointType = builder.objectRef<BurndownPoint>('BurndownPoint');
  BurndownPointType.implement({ fields: (t) => ({
    date:            t.string({ nullable: true, resolve: (p) => p.date ?? null }),
    remainingPoints: t.float({ resolve: (p) => p.remainingPoints }),
    idealPoints:     t.float({ resolve: (p) => p.idealPoints }),
  }) });
  const BurndownType = builder.objectRef<BurndownReport>('BurndownReport');
  BurndownType.implement({ fields: (t) => ({
    totalPoints: t.float({ resolve: (r) => r.totalPoints }),
    startDate:   t.string({ nullable: true, resolve: (r) => r.startDate ?? null }),
    endDate:     t.string({ nullable: true, resolve: (r) => r.endDate ?? null }),
    points:      t.field({ type: [BurndownPointType], resolve: (r) => r.points }),
  }) });

  const VelocityType = builder.objectRef<VelocityEntry>('VelocityEntry');
  VelocityType.implement({ fields: (t) => ({
    sprintId:        t.exposeString('sprintId'),
    sprintName:      t.exposeString('sprintName'),
    startDate:       t.string({ nullable: true, resolve: (r) => r.startDate ?? null }),
    endDate:         t.string({ nullable: true, resolve: (r) => r.endDate ?? null }),
    committedPoints: t.float({ resolve: (r) => r.committedPoints }),
    completedPoints: t.float({ resolve: (r) => r.completedPoints }),
  }) });

  const SprintStatusType = builder.objectRef<SprintStatusBreakdown>('SprintStatusBreakdown');
  SprintStatusType.implement({ fields: (t) => ({
    status:      t.exposeString('status'),
    issueCount:  t.exposeInt('issueCount'),
    storyPoints: t.float({ resolve: (r) => r.storyPoints }),
  }) });
  const SprintSummaryType = builder.objectRef<SprintSummaryReport>('SprintSummaryReport');
  SprintSummaryType.implement({ fields: (t) => ({
    sprintId:         t.exposeString('sprintId'),
    sprintName:       t.exposeString('sprintName'),
    startDate:        t.string({ nullable: true, resolve: (r) => r.startDate ?? null }),
    endDate:          t.string({ nullable: true, resolve: (r) => r.endDate ?? null }),
    totalIssues:      t.exposeInt('totalIssues'),
    completedIssues:  t.exposeInt('completedIssues'),
    incompleteIssues: t.exposeInt('incompleteIssues'),
    totalPoints:      t.float({ resolve: (r) => r.totalPoints }),
    completedPoints:  t.float({ resolve: (r) => r.completedPoints }),
    statusBreakdown:  t.field({ type: [SprintStatusType], resolve: (r) => r.statusBreakdown }),
  }) });

  const WorkloadType = builder.objectRef<WorkloadEntry>('WorkloadEntry');
  WorkloadType.implement({ fields: (t) => ({
    assigneeId:   t.exposeString('assigneeId'),
    assigneeName: t.exposeString('assigneeName'),
    totalIssues:  t.exposeInt('totalIssues'),
    openIssues:   t.exposeInt('openIssues'),
    doneIssues:   t.exposeInt('doneIssues'),
    totalPoints:  t.float({ resolve: (r) => r.totalPoints }),
    openPoints:   t.float({ resolve: (r) => r.openPoints }),
  }) });

  const CreatedVsResolvedType = builder.objectRef<CreatedVsResolvedEntry>('CreatedVsResolvedEntry');
  CreatedVsResolvedType.implement({ fields: (t) => ({
    weekStart: t.string({ nullable: true, resolve: (r) => r.weekStart ?? null }),
    weekEnd:   t.string({ nullable: true, resolve: (r) => r.weekEnd ?? null }),
    created:   t.exposeInt('created'),
    resolved:  t.exposeInt('resolved'),
  }) });

  const BurnupPointType = builder.objectRef<BurnupPoint>('BurnupPoint');
  BurnupPointType.implement({ fields: (t) => ({
    date:            t.string({ nullable: true, resolve: (p) => p.date ?? null }),
    completedPoints: t.float({ resolve: (p) => p.completedPoints }),
    scopePoints:     t.float({ resolve: (p) => p.scopePoints }),
  }) });
  const BurnupType = builder.objectRef<BurnupReport>('BurnupReport');
  BurnupType.implement({ fields: (t) => ({
    sprintId:         t.exposeString('sprintId'),
    sprintName:       t.exposeString('sprintName'),
    startDate:        t.string({ nullable: true, resolve: (r) => r.startDate ?? null }),
    endDate:          t.string({ nullable: true, resolve: (r) => r.endDate ?? null }),
    totalScopePoints: t.float({ resolve: (r) => r.totalScopePoints }),
    completedPoints:  t.float({ resolve: (r) => r.completedPoints }),
    points:           t.field({ type: [BurnupPointType], resolve: (r) => r.points }),
  }) });

  const CumulativeFlowType = builder.objectRef<CumulativeFlowEntry>('CumulativeFlowEntry');
  CumulativeFlowType.implement({ fields: (t) => ({
    date:       t.string({ nullable: true, resolve: (r) => r.date ?? null }),
    status:     t.exposeString('status'),
    issueCount: t.exposeInt('issueCount'),
  }) });

  const LeadCycleTaskType = builder.objectRef<LeadCycleTimeEntry>('LeadCycleTimeEntry');
  LeadCycleTaskType.implement({ fields: (t) => ({
    taskId:           t.exposeString('taskId'),
    issueKey:         t.exposeString('issueKey'),
    title:            t.exposeString('title'),
    createdAt:        t.string({ nullable: true, resolve: (r) => r.createdAt ?? null }),
    startedAt:        t.string({ nullable: true, resolve: (r) => r.startedAt ?? null }),
    resolvedAt:       t.string({ nullable: true, resolve: (r) => r.resolvedAt ?? null }),
    leadTimeSeconds:  t.int({ nullable: true, resolve: (r) => r.leadTimeSeconds ?? null }),
    cycleTimeSeconds: t.int({ nullable: true, resolve: (r) => r.cycleTimeSeconds ?? null }),
  }) });
  const LeadCycleType = builder.objectRef<LeadCycleTimeReport>('LeadCycleTimeReport');
  LeadCycleType.implement({ fields: (t) => ({
    scopeType:           t.exposeString('scopeType'),
    scopeId:             t.exposeString('scopeId'),
    rangeStart:          t.string({ nullable: true, resolve: (r) => r.rangeStart ?? null }),
    rangeEnd:            t.string({ nullable: true, resolve: (r) => r.rangeEnd ?? null }),
    avgLeadTimeSeconds:  t.int({ nullable: true, resolve: (r) => r.avgLeadTimeSeconds ?? null }),
    avgCycleTimeSeconds: t.int({ nullable: true, resolve: (r) => r.avgCycleTimeSeconds ?? null }),
    tasks:               t.field({ type: [LeadCycleTaskType], resolve: (r) => r.tasks }),
  }) });

  const PortfolioType = builder.objectRef<PortfolioEntry>('PortfolioEntry');
  PortfolioType.implement({ fields: (t) => ({
    scopeType:       t.exposeString('scopeType'),
    scopeId:         t.exposeString('scopeId'),
    scopeName:       t.exposeString('scopeName'),
    totalIssues:     t.exposeInt('totalIssues'),
    completedIssues: t.exposeInt('completedIssues'),
    totalPoints:     t.float({ resolve: (r) => r.totalPoints }),
    completedPoints: t.float({ resolve: (r) => r.completedPoints }),
    progressPct:     t.exposeInt('progressPct'),
    onTrack:         t.boolean({ resolve: (r) => r.onTrack }),
  }) });

  // ── Queries (all nine) ──
  builder.queryFields((t) => ({
    burndown: t.field({
      type: BurndownType, nullable: true,
      args: { sprintId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const ws = await workspaceForSprint(a.sprintId);
        if (!ws) notFound('Sprint not found');
        await requireWorkspacePermission(ctx, ws, 'report.read');
        return svc.burndown(a.sprintId);
      },
    }),
    velocity: t.field({
      type: [VelocityType],
      args: { projectId: t.arg.string({ required: true }), numSprints: t.arg.int({ required: false }) },
      resolve: async (_, a, ctx) => {
        const ws = await workspaceForProject(a.projectId);
        if (!ws) notFound('Project not found');
        await requireWorkspacePermission(ctx, ws, 'report.read');
        return svc.velocity(a.projectId, a.numSprints ?? 5);
      },
    }),
    sprintSummary: t.field({
      type: SprintSummaryType, nullable: true,
      args: { sprintId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const ws = await workspaceForSprint(a.sprintId);
        if (!ws) notFound('Sprint not found');
        await requireWorkspacePermission(ctx, ws, 'report.read');
        return svc.sprintSummary(a.sprintId);
      },
    }),
    workload: t.field({
      type: [WorkloadType],
      args: { projectId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const ws = await workspaceForProject(a.projectId);
        if (!ws) notFound('Project not found');
        await requireWorkspacePermission(ctx, ws, 'report.read');
        return svc.workload(a.projectId);
      },
    }),
    createdVsResolved: t.field({
      type: [CreatedVsResolvedType],
      args: { projectId: t.arg.string({ required: true }), weeks: t.arg.int({ required: false }) },
      resolve: async (_, a, ctx) => {
        const ws = await workspaceForProject(a.projectId);
        if (!ws) notFound('Project not found');
        await requireWorkspacePermission(ctx, ws, 'report.read');
        return svc.createdVsResolved(a.projectId, a.weeks ?? 8);
      },
    }),
    burnup: t.field({
      type: BurnupType, nullable: true,
      args: { sprintId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const ws = await workspaceForSprint(a.sprintId);
        if (!ws) notFound('Sprint not found');
        await requireWorkspacePermission(ctx, ws, 'report.read');
        return svc.burnup(a.sprintId);
      },
    }),
    cumulativeFlow: t.field({
      type: [CumulativeFlowType],
      args: { scopeType: t.arg.string({ required: true }), scopeId: t.arg.string({ required: true }), weeks: t.arg.int({ required: false }) },
      resolve: async (_, a, ctx) => {
        const ws = await workspaceForScope(a.scopeType, a.scopeId);
        if (!ws) notFound('Scope not found');
        await requireWorkspacePermission(ctx, ws, 'report.read');
        return svc.cumulativeFlow(a.scopeType, a.scopeId, a.weeks ?? 8);
      },
    }),
    leadCycleTime: t.field({
      type: LeadCycleType,
      args: { scopeType: t.arg.string({ required: true }), scopeId: t.arg.string({ required: true }), weeks: t.arg.int({ required: false }) },
      resolve: async (_, a, ctx) => {
        const ws = await workspaceForScope(a.scopeType, a.scopeId);
        if (!ws) notFound('Scope not found');
        await requireWorkspacePermission(ctx, ws, 'report.read');
        return svc.leadCycleTime(a.scopeType, a.scopeId, a.weeks ?? 12);
      },
    }),
    portfolio: t.field({
      type: [PortfolioType],
      args: { scopeType: t.arg.string({ required: true }), scopeIds: t.arg.stringList({ required: true }) },
      resolve: async (_, a, ctx) => {
        const ids = a.scopeIds;
        if (!ids.length) notFound('scopeIds required');
        const ws = await workspaceForScope(a.scopeType, ids[0]);
        if (!ws) notFound('Scope not found');
        await requireWorkspacePermission(ctx, ws, 'report.read');
        for (const id of ids.slice(1)) {
          const w = await workspaceForScope(a.scopeType, id);
          if (w !== ws) notFound('Scope not found');
        }
        return svc.portfolio(a.scopeType, ids);
      },
    }),
  }));
}
