import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { formService } from '../modules/forms/form.service.js';
import { notFound, requireObjectLevel, requireAuth } from './authz.js';
import { isWorkspaceMember } from '../modules/workspaces/membership.js';
import type { Form, FormSubmission, CreateFormInput, UpdateFormInput } from '@projectflow/types';

export function registerFormsGraphql(): void {
  // Config + FieldMapping transported as JSON strings (mirrors Template.snapshot
  // / SavedView.config) — keeps the schema flat over the nested form definition.
  const FormType = builder.objectRef<Form>('Form');
  FormType.implement({ fields: (t) => ({
    id:           t.exposeString('id'),
    workspaceId:  t.exposeString('workspaceId'),
    scopeType:    t.exposeString('scopeType'),
    scopeId:      t.exposeString('scopeId'),
    name:         t.exposeString('name'),
    config:       t.string({ resolve: (f) => JSON.stringify(f.config) }),
    targetListId: t.exposeString('targetListId'),
    fieldMapping: t.string({ resolve: (f) => JSON.stringify(f.fieldMapping) }),
    templateId:   t.string({ nullable: true, resolve: (f) => f.templateId ?? null }),
    isPublic:     t.boolean({ resolve: (f) => f.isPublic }),
    publicSlug:   t.string({ nullable: true, resolve: (f) => f.publicSlug ?? null }),
    authRequired: t.boolean({ resolve: (f) => f.authRequired }),
    createdById:  t.exposeString('createdById'),
    createdAt:    t.string({ resolve: (f) => f.createdAt }),
    updatedAt:    t.string({ resolve: (f) => f.updatedAt }),
  }) });

  const SubmissionType = builder.objectRef<FormSubmission>('FormSubmission');
  SubmissionType.implement({ fields: (t) => ({
    id:            t.exposeString('id'),
    formId:        t.exposeString('formId'),
    answers:       t.string({ resolve: (s) => JSON.stringify(s.answers) }),
    createdTaskId: t.string({ nullable: true, resolve: (s) => s.createdTaskId ?? null }),
    submittedById: t.string({ nullable: true, resolve: (s) => s.submittedById ?? null }),
    submittedAt:   t.string({ resolve: (s) => s.submittedAt }),
  }) });

  builder.queryFields((t) => ({
    forms: t.field({
      type: [FormType],
      args: {
        workspaceId: t.arg.string({ required: true }),
        scopeType:   t.arg.string({ required: false }),
        scopeId:     t.arg.string({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        if (!(await isWorkspaceMember(a.workspaceId, ctx.user.userId)))
          throw new GraphQLError('You do not have access', { extensions: { code: 'FORBIDDEN' } });
        return formService.list(a.workspaceId, a.scopeType ?? null, a.scopeId ?? null);
      },
    }),
    form: t.field({
      type: FormType,
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const form = await formService.getById(a.id);
        if (!form) notFound('Form not found');
        await requireObjectLevel(ctx, form!.scopeType, form!.scopeId, 'VIEW');
        return form;
      },
    }),
    formSubmissions: t.field({
      type: [SubmissionType],
      args: { formId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const form = await formService.getById(a.formId);
        if (!form) notFound('Form not found');
        await requireObjectLevel(ctx, form!.scopeType, form!.scopeId, 'VIEW');
        return formService.listSubmissions(form!.id);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    createForm: t.field({
      type: FormType,
      args: {
        workspaceId:  t.arg.string({ required: true }),
        scopeType:    t.arg.string({ required: true }),
        scopeId:      t.arg.string({ required: true }),
        name:         t.arg.string({ required: true }),
        config:       t.arg.string({ required: true }),   // JSON
        targetListId: t.arg.string({ required: true }),
        fieldMapping: t.arg.string({ required: true }),   // JSON
        templateId:   t.arg.string({ required: false }),
        isPublic:     t.arg.boolean({ required: false }),
        publicSlug:   t.arg.string({ required: false }),
        authRequired: t.arg.boolean({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        requireAuth(ctx);
        if (!(await isWorkspaceMember(a.workspaceId, ctx.user.userId)))
          throw new GraphQLError('You do not have access', { extensions: { code: 'FORBIDDEN' } });
        await requireObjectLevel(ctx, a.scopeType as Form['scopeType'], a.scopeId, 'EDIT');
        // Reconcile the scope node against the declared workspace (mirrors REST +
        // 7b whiteboard) so a foreign scope can't be attached cross-tenant.
        const resolvedWs = await formService.getScopeWorkspaceId(a.scopeType as Form['scopeType'], a.scopeId);
        if (!resolvedWs) throw new GraphQLError('Scope not found', { extensions: { code: 'NOT_FOUND' } });
        if (a.workspaceId !== resolvedWs)
          throw new GraphQLError('workspaceId does not match scope', { extensions: { code: 'WORKSPACE_MISMATCH' } });
        const input: CreateFormInput = {
          workspaceId: resolvedWs, scopeType: a.scopeType as Form['scopeType'], scopeId: a.scopeId,
          name: a.name, config: JSON.parse(a.config), targetListId: a.targetListId,
          fieldMapping: JSON.parse(a.fieldMapping), templateId: a.templateId ?? null,
          isPublic: a.isPublic ?? undefined, publicSlug: a.publicSlug ?? undefined, authRequired: a.authRequired ?? undefined,
        };
        return formService.create(input, ctx.user.userId);
      },
    }),
    updateForm: t.field({
      type: FormType,
      nullable: true,
      args: {
        id:           t.arg.string({ required: true }),
        name:         t.arg.string({ required: false }),
        config:       t.arg.string({ required: false }),
        targetListId: t.arg.string({ required: false }),
        fieldMapping: t.arg.string({ required: false }),
        templateId:   t.arg.string({ required: false }),
        isPublic:     t.arg.boolean({ required: false }),
        publicSlug:   t.arg.string({ required: false }),
        authRequired: t.arg.boolean({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        const form = await formService.getById(a.id);
        if (!form) notFound('Form not found');
        await requireObjectLevel(ctx, form!.scopeType, form!.scopeId, 'EDIT');
        const patch: UpdateFormInput = {
          name: a.name ?? undefined,
          config: a.config ? JSON.parse(a.config) : undefined,
          targetListId: a.targetListId ?? undefined,
          fieldMapping: a.fieldMapping ? JSON.parse(a.fieldMapping) : undefined,
          templateId: a.templateId ?? undefined,
          isPublic: a.isPublic ?? undefined,
          publicSlug: a.publicSlug ?? undefined,
          authRequired: a.authRequired ?? undefined,
        };
        return formService.update(form!.id, patch);
      },
    }),
    deleteForm: t.field({
      type: 'Boolean',
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const form = await formService.getById(a.id);
        if (!form) notFound('Form not found');
        await requireObjectLevel(ctx, form!.scopeType, form!.scopeId, 'EDIT');
        const deleted = await formService.delete(form!.id);
        return !!deleted;
      },
    }),
  }));
}
