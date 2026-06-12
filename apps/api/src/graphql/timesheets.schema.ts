import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { timesheetService } from '../modules/timesheets/timesheet.service.js';
import { requireWorkspacePermission, notFound } from './authz.js';
import type { Timesheet, TimesheetAggregate, TimesheetAggregateRow, TimesheetAggregateTotals } from '@projectflow/types';

export function registerTimesheetsGraphql(): void {
  const TimesheetType = builder.objectRef<Timesheet>('Timesheet');
  TimesheetType.implement({ fields: (t) => ({
    id:           t.exposeString('id'),
    workspaceId:  t.exposeString('workspaceId'),
    userId:       t.exposeString('userId'),
    periodStart:  t.exposeString('periodStart'),
    periodEnd:    t.exposeString('periodEnd'),
    status:       t.exposeString('status'),
    submittedAt:  t.string({ nullable: true, resolve: (r) => r.submittedAt ?? null }),
    reviewedById: t.string({ nullable: true, resolve: (r) => r.reviewedById ?? null }),
    reviewedAt:   t.string({ nullable: true, resolve: (r) => r.reviewedAt ?? null }),
    note:         t.string({ nullable: true, resolve: (r) => r.note ?? null }),
    createdAt:    t.exposeString('createdAt'),
    updatedAt:    t.exposeString('updatedAt'),
  }) });

  const TimesheetRowType = builder.objectRef<TimesheetAggregateRow>('TimesheetAggregateRow');
  TimesheetRowType.implement({ fields: (t) => ({
    workDate:           t.exposeString('workDate'),
    taskId:             t.exposeString('taskId'),
    taskTitle:          t.exposeString('taskTitle'),
    totalSeconds:       t.exposeInt('totalSeconds'),
    billableSeconds:    t.exposeInt('billableSeconds'),
    nonBillableSeconds: t.exposeInt('nonBillableSeconds'),
  }) });

  const TimesheetTotalsType = builder.objectRef<TimesheetAggregateTotals>('TimesheetAggregateTotals');
  TimesheetTotalsType.implement({ fields: (t) => ({
    totalSeconds:       t.exposeInt('totalSeconds'),
    billableSeconds:    t.exposeInt('billableSeconds'),
    nonBillableSeconds: t.exposeInt('nonBillableSeconds'),
  }) });

  const TimesheetAggregateType = builder.objectRef<TimesheetAggregate>('TimesheetAggregate');
  TimesheetAggregateType.implement({ fields: (t) => ({
    rows:   t.field({ type: [TimesheetRowType], resolve: (a) => a.rows }),
    totals: t.field({ type: TimesheetTotalsType, resolve: (a) => a.totals }),
  }) });

  builder.queryFields((t) => ({
    timesheet: t.field({
      type: TimesheetType,
      nullable: true,
      args: {
        workspaceId: t.arg.string({ required: true }),
        periodStart: t.arg.string({ required: true }),
        periodEnd:   t.arg.string({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, 'timesheet.read');
        return timesheetService.getOrCreate(a.workspaceId, (ctx.user as any).userId, a.periodStart, a.periodEnd);
      },
    }),
    timesheetAggregate: t.field({
      type: TimesheetAggregateType,
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const ts = await timesheetService.getById(a.id);
        if (!ts) notFound('Timesheet not found');
        await requireWorkspacePermission(ctx, ts!.workspaceId, 'timesheet.read');
        return timesheetService.aggregate(a.id);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    submitTimesheet: t.field({
      type: TimesheetType,
      args: { id: t.arg.string({ required: true }), note: t.arg.string({ required: false }) },
      resolve: async (_, a, ctx) => {
        const ts = await timesheetService.getById(a.id);
        if (!ts) notFound('Timesheet not found');
        await requireWorkspacePermission(ctx, ts!.workspaceId, 'timesheet.submit');
        try {
          return await timesheetService.submit(a.id, (ctx.user as any).userId, a.note ?? null);
        } catch (err: any) {
          if (err?.number === 51810) throw new GraphQLError(err.message, { extensions: { code: 'ILLEGAL_TRANSITION' } });
          throw err;
        }
      },
    }),
    reviewTimesheet: t.field({
      type: TimesheetType,
      args: { id: t.arg.string({ required: true }), decision: t.arg.string({ required: true }), note: t.arg.string({ required: false }) },
      resolve: async (_, a, ctx) => {
        const ts = await timesheetService.getById(a.id);
        if (!ts) notFound('Timesheet not found');
        await requireWorkspacePermission(ctx, ts!.workspaceId, 'timesheet.approve');
        if (a.decision !== 'approved' && a.decision !== 'rejected')
          throw new GraphQLError('Decision must be approved or rejected', { extensions: { code: 'BAD_INPUT' } });
        try {
          return await timesheetService.review(a.id, (ctx.user as any).userId, a.decision, a.note ?? null);
        } catch (err: any) {
          if (err?.number === 51811) throw new GraphQLError(err.message, { extensions: { code: 'ILLEGAL_TRANSITION' } });
          throw err;
        }
      },
    }),
  }));
}
