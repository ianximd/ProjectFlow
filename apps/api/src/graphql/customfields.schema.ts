import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { customFieldService } from '../modules/customfields/customfield.service.js';
import { FieldValidationError } from '../modules/customfields/customfield.errors.js';
import { TaskRepository } from '../modules/tasks/task.repository.js';
import { requireObjectLevel } from './authz.js';
import type { CustomField, EffectiveField, HierarchyNodeType } from '@projectflow/types';

const taskRepo = new TaskRepository();
async function taskListId(taskId: string): Promise<string | null> {
  const t = await taskRepo.getById(taskId);
  return (t as any)?.listId ?? (t as any)?.ListId ?? null;
}

export function registerCustomFieldsGraphql(): void {
  const CustomFieldType = builder.objectRef<CustomField>('CustomField');
  CustomFieldType.implement({ fields: (t) => ({
    id: t.exposeString('id'),
    workspaceId: t.exposeString('workspaceId'),
    scopeType: t.exposeString('scopeType'),
    scopeId: t.exposeString('scopeId'),
    type: t.exposeString('type'),
    name: t.exposeString('name'),
    required: t.exposeBoolean('required'),
    position: t.exposeFloat('position'),
    config: t.string({ nullable: true, resolve: (f) => (f.config ? JSON.stringify(f.config) : null) }),
  }) });

  const EffectiveFieldType = builder.objectRef<EffectiveField>('EffectiveField');
  EffectiveFieldType.implement({ fields: (t) => ({
    field: t.field({ type: CustomFieldType, resolve: (e) => e.field }),
    value: t.string({ nullable: true, resolve: (e) => (e.value == null ? null : JSON.stringify(e.value)) }),
  }) });

  builder.queryFields((t) => ({
    customFields: t.field({
      type: [CustomFieldType],
      args: { scopeType: t.arg.string({ required: true }), scopeId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireObjectLevel(ctx, a.scopeType as HierarchyNodeType, a.scopeId, 'VIEW');
        return customFieldService.list(a.scopeType as any, a.scopeId);
      },
    }),
    taskEffectiveFields: t.field({
      type: [EffectiveFieldType],
      args: { taskId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireObjectLevel(ctx, 'LIST', await taskListId(a.taskId), 'VIEW');
        return customFieldService.effectiveForTask(a.taskId);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    setTaskCustomField: t.field({
      type: [EffectiveFieldType],
      args: { taskId: t.arg.string({ required: true }), fieldId: t.arg.string({ required: true }), value: t.arg.string({ required: false }) },
      resolve: async (_, a, ctx) => {
        await requireObjectLevel(ctx, 'LIST', await taskListId(a.taskId), 'EDIT');
        const decoded = a.value == null ? null : JSON.parse(a.value);
        try { await customFieldService.setValue(a.taskId, a.fieldId, decoded); }
        catch (e) { if (e instanceof FieldValidationError) throw new GraphQLError(e.message, { extensions: { code: e.fieldCode } }); throw e; }
        return customFieldService.effectiveForTask(a.taskId);
      },
    }),
  }));
}
