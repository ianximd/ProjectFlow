import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { goalService, InvalidGoalError } from '../modules/goals/goal.service.js';
import { requireWorkspacePermission } from './authz.js';
import type { Goal, Target, GoalWithProgress } from '@projectflow/types';

export function registerGoalsGraphql(): void {
  const TargetType = builder.objectRef<Target & { ratio?: number }>('Target');
  TargetType.implement({ fields: (t) => ({
    id:           t.exposeString('id'),
    goalId:       t.exposeString('goalId'),
    kind:         t.exposeString('kind'),
    name:         t.exposeString('name'),
    unit:         t.string({ nullable: true, resolve: (r) => r.unit ?? null }),
    currencyCode: t.string({ nullable: true, resolve: (r) => r.currencyCode ?? null }),
    startValue:   t.float({ nullable: true, resolve: (r) => r.startValue ?? null }),
    targetValue:  t.float({ nullable: true, resolve: (r) => r.targetValue ?? null }),
    currentValue: t.float({ nullable: true, resolve: (r) => r.currentValue ?? null }),
    taskFilter:   t.string({ nullable: true, resolve: (r) => r.taskFilter ?? null }),
    position:     t.float({ resolve: (r) => r.position }),
    ratio:        t.float({ nullable: true, resolve: (r) => r.ratio ?? null }),
  }) });

  const GoalType = builder.objectRef<GoalWithProgress | Goal>('Goal');
  GoalType.implement({ fields: (t) => ({
    id:          t.exposeString('id'),
    workspaceId: t.exposeString('workspaceId'),
    scopeType:   t.exposeString('scopeType'),
    scopeId:     t.string({ nullable: true, resolve: (g) => g.scopeId ?? null }),
    folderId:    t.string({ nullable: true, resolve: (g) => g.folderId ?? null }),
    name:        t.exposeString('name'),
    description: t.string({ nullable: true, resolve: (g) => g.description ?? null }),
    status:      t.exposeString('status'),
    dueDate:     t.string({ nullable: true, resolve: (g) => g.dueDate ?? null }),
    progress:    t.float({ nullable: true, resolve: (g) => (g as GoalWithProgress).progress ?? null }),
    targets:     t.field({ type: [TargetType], nullable: true, resolve: (g) => (g as GoalWithProgress).targets ?? null }),
  }) });

  builder.queryFields((t) => ({
    goals: t.field({
      type: [GoalType],
      args: { workspaceId: t.arg.string({ required: true }), folderId: t.arg.string({ required: false }) },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, ['goal.create', 'goal.update', 'goal.delete']);
        return (await goalService.listGoals(a.workspaceId, a.folderId ?? null)) as any;
      },
    }),
    goal: t.field({
      type: GoalType,
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const wid = await goalService.getGoalWorkspaceId(a.id);
        await requireWorkspacePermission(ctx, wid, ['goal.create', 'goal.update', 'goal.delete']);
        return (await goalService.getGoalWithProgress(a.id)) as any;
      },
    }),
  }));

  builder.mutationFields((t) => ({
    createGoal: t.field({
      type: GoalType,
      args: {
        workspaceId: t.arg.string({ required: true }),
        name:        t.arg.string({ required: true }),
        folderId:    t.arg.string({ required: false }),
        description: t.arg.string({ required: false }),
        dueDate:     t.arg.string({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, 'goal.create');
        try {
          return (await goalService.createGoal({
            workspaceId: a.workspaceId, name: a.name, folderId: a.folderId ?? null,
            description: a.description ?? null, dueDate: a.dueDate ?? null,
            ownerId: (ctx.user as any).userId,
          })) as any;
        } catch (err: any) {
          if (err instanceof InvalidGoalError) throw new GraphQLError(err.message, { extensions: { code: err.code } });
          throw err;
        }
      },
    }),
    updateGoal: t.field({
      type: GoalType,
      nullable: true,
      args: {
        id:     t.arg.string({ required: true }),
        name:   t.arg.string({ required: false }),
        status: t.arg.string({ required: false }),
        dueDate: t.arg.string({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        const wid = await goalService.getGoalWorkspaceId(a.id);
        await requireWorkspacePermission(ctx, wid, 'goal.update');
        try {
          return (await goalService.updateGoal(a.id, {
            name: a.name ?? undefined, status: a.status ?? undefined, dueDate: a.dueDate ?? undefined,
          })) as any;
        } catch (err: any) {
          if (err instanceof InvalidGoalError) throw new GraphQLError(err.message, { extensions: { code: err.code } });
          throw err;
        }
      },
    }),
    deleteGoal: t.field({
      type: 'Boolean',
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const wid = await goalService.getGoalWorkspaceId(a.id);
        await requireWorkspacePermission(ctx, wid, 'goal.delete');
        await goalService.deleteGoal(a.id);
        return true;
      },
    }),
    createTarget: t.field({
      type: TargetType,
      args: {
        goalId:      t.arg.string({ required: true }),
        kind:        t.arg.string({ required: true }),
        name:        t.arg.string({ required: true }),
        unit:        t.arg.string({ required: false }),
        currencyCode: t.arg.string({ required: false }),
        startValue:  t.arg.float({ required: false }),
        targetValue: t.arg.float({ required: false }),
        currentValue: t.arg.float({ required: false }),
        taskFilter:  t.arg.string({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        const wid = await goalService.getGoalWorkspaceId(a.goalId);
        await requireWorkspacePermission(ctx, wid, 'goal.update');
        try {
          return (await goalService.createTarget(a.goalId, {
            kind: a.kind, name: a.name, unit: a.unit ?? null, currencyCode: a.currencyCode ?? null,
            startValue: a.startValue ?? null, targetValue: a.targetValue ?? null,
            currentValue: a.currentValue ?? null, taskFilter: a.taskFilter ?? null,
          })) as any;
        } catch (err: any) {
          if (err instanceof InvalidGoalError) throw new GraphQLError(err.message, { extensions: { code: err.code } });
          throw err;
        }
      },
    }),
  }));
}
