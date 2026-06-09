import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { AutomationService } from '../modules/automation/automation.service.js';
import { AutomationRepository } from '../modules/automation/automation.repository.js';
import { ProjectRepository } from '../modules/projects/project.repository.js';
import { notFound, requireWorkspacePermission, requireAuth } from './authz.js';
import type { AutomationRule, AutomationRun, AutomationTemplate, AutomationUsage } from '@projectflow/types';

const svc      = new AutomationService();
const ruleRepo = new AutomationRepository();
const projRepo = new ProjectRepository();

export function registerAutomationGraphql(): void {
  const AutomationRuleType = builder.objectRef<AutomationRule>('AutomationRule');
  AutomationRuleType.implement({ fields: (t) => ({
    id:             t.exposeString('id'),
    scopeType:      t.exposeString('scopeType'),
    workspaceId:    t.exposeString('workspaceId'),
    projectId:      t.string({ nullable: true, resolve: (r) => r.projectId ?? null }),
    name:           t.exposeString('name'),
    isEnabled:      t.boolean({ resolve: (r) => r.isEnabled }),
    trigger:        t.string({ resolve: (r) => JSON.stringify(r.trigger) }),
    conditions:     t.string({ resolve: (r) => JSON.stringify(r.conditions) }),
    actions:        t.string({ resolve: (r) => JSON.stringify(r.actions) }),
    executionCount: t.exposeInt('executionCount'),
    lastExecutedAt: t.field({ type: 'Date', nullable: true, resolve: (r) => (r.lastExecutedAt ? new Date(r.lastExecutedAt) : null) }),
  }) });

  const AutomationRunType = builder.objectRef<AutomationRun>('AutomationRun');
  AutomationRunType.implement({ fields: (t) => ({
    id:            t.exposeString('id'),
    ruleId:        t.exposeString('ruleId'),
    triggerType:   t.exposeString('triggerType'),
    status:        t.exposeString('status'),
    error:         t.string({ nullable: true, resolve: (r) => r.error ?? null }),
    actionResults: t.string({ nullable: true, resolve: (r) => (r.actionResults ? JSON.stringify(r.actionResults) : null) }),
    depth:         t.exposeInt('depth'),
    startedAt:     t.field({ type: 'Date', resolve: (r) => new Date(r.startedAt) }),
    finishedAt:    t.field({ type: 'Date', nullable: true, resolve: (r) => (r.finishedAt ? new Date(r.finishedAt) : null) }),
    durationMs:    t.int({ nullable: true, resolve: (r) => r.durationMs ?? null }),
  }) });

  const AutomationTemplateType = builder.objectRef<AutomationTemplate>('AutomationTemplate');
  AutomationTemplateType.implement({ fields: (t) => ({
    key:         t.exposeString('key'),
    title:       t.string({ resolve: (r) => r.title ?? r.key }),
    description: t.string({ resolve: (r) => r.description ?? '' }),
    trigger:     t.string({ resolve: (r) => JSON.stringify(r.trigger) }),
    conditions:  t.string({ resolve: (r) => JSON.stringify(r.conditions) }),
    actions:     t.string({ resolve: (r) => JSON.stringify(r.actions) }),
  }) });

  const AutomationUsageType = builder.objectRef<AutomationUsage>('AutomationUsage');
  AutomationUsageType.implement({ fields: (t) => ({
    workspaceId: t.exposeString('workspaceId'),
    period:      t.exposeString('period'),
    runCount:    t.exposeInt('runCount'),
  }) });

  builder.queryFields((t) => ({
    automationRules: t.field({
      type: [AutomationRuleType],
      args: { projectId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const workspaceId = await projRepo.getWorkspaceId(a.projectId);
        if (!workspaceId) notFound('Project not found');
        await requireWorkspacePermission(ctx, workspaceId, 'automation.read');
        return svc.list(a.projectId);
      },
    }),
    automationRuns: t.field({
      type: [AutomationRunType],
      args: {
        ruleId: t.arg.string({ required: true }),
        limit:  t.arg.int({ required: false }),
        offset: t.arg.int({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        const workspaceId = await ruleRepo.getWorkspaceId(a.ruleId);
        if (!workspaceId) notFound('Rule not found');
        await requireWorkspacePermission(ctx, workspaceId, 'automation.update');
        return svc.listRuns(a.ruleId, a.limit ?? 50, a.offset ?? 0);
      },
    }),
    automationTemplates: t.field({
      type: [AutomationTemplateType],
      args: { locale: t.arg.string({ required: false }) },
      resolve: (_, a, ctx) => {
        requireAuth(ctx);                       // static catalog → auth-only
        return svc.listTemplates(a.locale ?? 'en');
      },
    }),
    automationUsage: t.field({
      type: AutomationUsageType,
      args: { workspaceId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, 'automation.read');
        return svc.getUsage(a.workspaceId);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    createAutomationRule: t.field({
      type: AutomationRuleType,
      args: {
        scopeType:   t.arg.string({ required: true }),
        workspaceId: t.arg.string({ required: true }),
        projectId:   t.arg.string({ required: false }),
        name:        t.arg.string({ required: true }),
        trigger:     t.arg.string({ required: true }),
        conditions:  t.arg.string({ required: true }),
        actions:     t.arg.string({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, 'automation.create');
        let trigger: unknown, conditions: unknown, actions: unknown;
        try { trigger = JSON.parse(a.trigger); conditions = JSON.parse(a.conditions); actions = JSON.parse(a.actions); }
        catch { throw new GraphQLError('trigger/conditions/actions must be JSON strings', { extensions: { code: 'INVALID_INPUT' } }); }
        return svc.create(
          a.scopeType as any, a.workspaceId,
          a.scopeType === 'WORKSPACE' ? null : (a.projectId ?? null),
          a.name, trigger as any, conditions as any, actions as any,
        );
      },
    }),
    updateAutomationRule: t.field({
      type: AutomationRuleType,
      nullable: true,
      args: {
        id:         t.arg.string({ required: true }),
        name:       t.arg.string({ required: false }),
        trigger:    t.arg.string({ required: false }),
        conditions: t.arg.string({ required: false }),
        actions:    t.arg.string({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        const workspaceId = await ruleRepo.getWorkspaceId(a.id);
        if (!workspaceId) notFound('Rule not found');
        await requireWorkspacePermission(ctx, workspaceId, 'automation.update');
        let trigger: unknown, conditions: unknown, actions: unknown;
        try {
          trigger    = a.trigger    ? JSON.parse(a.trigger)    : undefined;
          conditions = a.conditions ? JSON.parse(a.conditions) : undefined;
          actions    = a.actions    ? JSON.parse(a.actions)    : undefined;
        } catch {
          throw new GraphQLError('trigger/conditions/actions must be JSON strings', { extensions: { code: 'INVALID_INPUT' } });
        }
        return svc.update(a.id, {
          name:       a.name ?? undefined,
          trigger:    trigger    as any,
          conditions: conditions as any,
          actions:    actions    as any,
        });
      },
    }),
    toggleAutomationRule: t.field({
      type: AutomationRuleType,
      nullable: true,
      args: { id: t.arg.string({ required: true }), isEnabled: t.arg.boolean({ required: true }) },
      resolve: async (_, a, ctx) => {
        const workspaceId = await ruleRepo.getWorkspaceId(a.id);
        if (!workspaceId) notFound('Rule not found');
        await requireWorkspacePermission(ctx, workspaceId, 'automation.update');
        return svc.update(a.id, { isEnabled: a.isEnabled });
      },
    }),
    deleteAutomationRule: t.field({
      type: 'Boolean',
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const workspaceId = await ruleRepo.getWorkspaceId(a.id);
        if (!workspaceId) notFound('Rule not found');
        await requireWorkspacePermission(ctx, workspaceId, 'automation.delete');
        await svc.delete(a.id);
        return true;
      },
    }),
  }));
}
