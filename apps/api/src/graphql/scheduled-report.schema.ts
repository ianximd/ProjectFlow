import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { scheduledReportService, InvalidCadenceError, ScheduleAccessError, RecipientNotMemberError } from '../modules/scheduled-reports/scheduled-report.service.js';
import { scheduledReportRepository } from '../modules/scheduled-reports/scheduled-report.repository.js';
import { notFound, requireWorkspacePermission } from './authz.js';
import type { ScheduledReport, ScheduledReportRun } from '@projectflow/types';

/** Re-throw known service errors as GraphQLErrors with stable codes; rethrow the rest. */
function rethrowAsGraphql(err: any): never {
  if (err instanceof ScheduleAccessError)     throw new GraphQLError(err.message, { extensions: { code: 'FORBIDDEN' } });
  if (err instanceof RecipientNotMemberError) throw new GraphQLError(err.message, { extensions: { code: err.code } });
  if (err instanceof InvalidCadenceError)     throw new GraphQLError(err.message, { extensions: { code: err.code } });
  throw err;
}

export function registerScheduledReportGraphql(): void {
  // The cadence is transported as a JSON string (mirrors TaskRecurrence.rule and
  // SavedView.config), keeping the schema flat and avoiding a deep input/output
  // type for the recurrence-shaped cadence rule.
  const ScheduledReportType = builder.objectRef<ScheduledReport>('ScheduledReport');
  ScheduledReportType.implement({ fields: (t) => ({
    id:              t.exposeString('id'),
    workspaceId:     t.exposeString('workspaceId'),
    dashboardId:     t.string({ nullable: true, resolve: (s) => s.dashboardId ?? null }),
    reportKind:      t.string({ nullable: true, resolve: (s) => s.reportKind ?? null }),
    cadence:         t.string({ resolve: (s) => JSON.stringify(s.cadence) }),
    deliveryChannel: t.exposeString('deliveryChannel'),
    recipients:      t.stringList({ resolve: (s) => s.recipients }),
    enabled:         t.boolean({ resolve: (s) => s.enabled }),
    nextRunAt:       t.field({ type: 'Date', nullable: true, resolve: (s) => (s.nextRunAt ? new Date(s.nextRunAt) : null) }),
    ownerId:         t.exposeString('ownerId'),
  }) });

  const RunType = builder.objectRef<ScheduledReportRun>('ScheduledReportRun');
  RunType.implement({ fields: (t) => ({
    id:                t.exposeString('id'),
    scheduledReportId: t.exposeString('scheduledReportId'),
    periodKey:         t.exposeString('periodKey'),
    ranAt:             t.field({ type: 'Date', resolve: (r) => new Date(r.ranAt) }),
    status:            t.exposeString('status'),
    snapshotRef:       t.string({ nullable: true, resolve: (r) => r.snapshotRef ?? null }),
    error:             t.string({ nullable: true, resolve: (r) => r.error ?? null }),
  }) });

  builder.queryFields((t) => ({
    scheduledReports: t.field({
      type: [ScheduledReportType],
      args: { workspaceId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, 'scheduled_report.manage');
        return scheduledReportService.listByWorkspace(a.workspaceId);
      },
    }),
    scheduledReportRuns: t.field({
      type: [RunType],
      args: { scheduledReportId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const s = await scheduledReportRepository.getById(a.scheduledReportId);
        if (!s) notFound('Schedule not found');
        await requireWorkspacePermission(ctx, s.workspaceId, 'scheduled_report.manage');
        return (await scheduledReportService.listRuns(a.scheduledReportId)).runs;
      },
    }),
  }));

  builder.mutationFields((t) => ({
    createScheduledReport: t.field({
      type: ScheduledReportType,
      args: {
        workspaceId:     t.arg.string({ required: true }),
        dashboardId:     t.arg.string({ required: false }),
        reportKind:      t.arg.string({ required: false }),
        cadence:         t.arg.string({ required: true }),   // JSON string
        deliveryChannel: t.arg.string({ required: false }),
        recipients:      t.arg.stringList({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        const workspaceId = await requireWorkspacePermission(ctx, a.workspaceId, 'scheduled_report.manage');
        let cadence: unknown;
        try { cadence = JSON.parse(a.cadence); }
        catch { throw new GraphQLError('cadence must be a JSON object string', { extensions: { code: 'INVALID_CADENCE' } }); }
        try {
          return await scheduledReportService.create({
            workspaceId,
            dashboardId:     a.dashboardId ?? null,
            reportKind:      a.reportKind ?? null,
            cadence:         cadence as any,
            deliveryChannel: (a.deliveryChannel as any) ?? undefined,
            recipients:      a.recipients,
          }, (ctx.user as any).userId);
        } catch (err: any) {
          rethrowAsGraphql(err);
        }
      },
    }),
    updateScheduledReport: t.field({
      type: ScheduledReportType,
      nullable: true,
      args: {
        id:              t.arg.string({ required: true }),
        cadence:         t.arg.string({ required: false }),
        deliveryChannel: t.arg.string({ required: false }),
        recipients:      t.arg.stringList({ required: false }),
        enabled:         t.arg.boolean({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        const s = await scheduledReportRepository.getById(a.id);
        if (!s) notFound('Schedule not found');
        await requireWorkspacePermission(ctx, s.workspaceId, 'scheduled_report.manage');
        let cadence: any;
        if (a.cadence) { try { cadence = JSON.parse(a.cadence); } catch { throw new GraphQLError('cadence must be a JSON object string', { extensions: { code: 'INVALID_CADENCE' } }); } }
        try {
          return await scheduledReportService.update(a.id, {
            cadence,
            deliveryChannel: (a.deliveryChannel as any) ?? undefined,
            recipients:      a.recipients ?? undefined,
            enabled:         a.enabled ?? undefined,
          });
        } catch (err: any) {
          rethrowAsGraphql(err);
        }
      },
    }),
    deleteScheduledReport: t.field({
      type: 'Boolean',
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const s = await scheduledReportRepository.getById(a.id);
        if (!s) notFound('Schedule not found');
        await requireWorkspacePermission(ctx, s.workspaceId, 'scheduled_report.manage');
        await scheduledReportService.delete(a.id);
        return true;
      },
    }),
  }));
}
