import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type {
  Form, FormSubmission, FormConfig, FormFieldMapping, CreateFormInput, UpdateFormInput,
} from '@projectflow/types';

interface FormRow {
  Id: string; WorkspaceId: string; ScopeType: string; ScopeId: string; Name: string;
  Config: string; TargetListId: string; FieldMapping: string; TemplateId: string | null;
  IsPublic: boolean; PublicSlug: string | null; AuthRequired: boolean;
  CreatedById: string; CreatedAt: Date | string; UpdatedAt: Date | string;
}

interface SubmissionRow {
  Id: string; FormId: string; Answers: string;
  CreatedTaskId: string | null; SubmittedById: string | null; SubmittedAt: Date | string;
}

const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : String(v));

function rowToForm(r: FormRow): Form {
  return {
    id:           r.Id,
    workspaceId:  r.WorkspaceId,
    scopeType:    r.ScopeType as Form['scopeType'],
    scopeId:      r.ScopeId,
    name:         r.Name,
    config:       JSON.parse(r.Config) as FormConfig,
    targetListId: r.TargetListId,
    fieldMapping: JSON.parse(r.FieldMapping) as FormFieldMapping,
    templateId:   r.TemplateId,
    isPublic:     Boolean(r.IsPublic),
    publicSlug:   r.PublicSlug,
    authRequired: Boolean(r.AuthRequired),
    createdById:  r.CreatedById,
    createdAt:    iso(r.CreatedAt),
    updatedAt:    iso(r.UpdatedAt),
  };
}

function rowToSubmission(r: SubmissionRow): FormSubmission {
  return {
    id:            r.Id,
    formId:        r.FormId,
    answers:       JSON.parse(r.Answers) as Record<string, unknown>,
    createdTaskId: r.CreatedTaskId,
    submittedById: r.SubmittedById,
    submittedAt:   iso(r.SubmittedAt),
  };
}

export class FormRepository {
  async create(id: string, input: CreateFormInput, createdById: string): Promise<Form> {
    const rows = await execSpOne<FormRow>('usp_Form_Create', [
      { name: 'Id',           type: sql.UniqueIdentifier, value: id },
      { name: 'WorkspaceId',  type: sql.UniqueIdentifier, value: input.workspaceId },
      { name: 'ScopeType',    type: sql.NVarChar(8),      value: input.scopeType },
      { name: 'ScopeId',      type: sql.UniqueIdentifier, value: input.scopeId },
      { name: 'Name',         type: sql.NVarChar(255),    value: input.name },
      { name: 'Config',       type: sql.NVarChar(sql.MAX), value: JSON.stringify(input.config) },
      { name: 'TargetListId', type: sql.UniqueIdentifier, value: input.targetListId },
      { name: 'FieldMapping', type: sql.NVarChar(sql.MAX), value: JSON.stringify(input.fieldMapping) },
      { name: 'TemplateId',   type: sql.UniqueIdentifier, value: input.templateId ?? null },
      { name: 'IsPublic',     type: sql.Bit,              value: input.isPublic ? 1 : 0 },
      { name: 'PublicSlug',   type: sql.NVarChar(64),     value: input.publicSlug ?? null },
      { name: 'AuthRequired', type: sql.Bit,              value: input.authRequired ? 1 : 0 },
      { name: 'CreatedById',  type: sql.UniqueIdentifier, value: createdById },
    ]);
    return rowToForm(rows[0]);
  }

  async update(id: string, patch: UpdateFormInput): Promise<Form | null> {
    const clearTemplate = patch.templateId === null;
    const clearSlug     = patch.publicSlug === null;
    const rows = await execSpOne<FormRow>('usp_Form_Update', [
      { name: 'Id',            type: sql.UniqueIdentifier, value: id },
      { name: 'Name',          type: sql.NVarChar(255),    value: patch.name ?? null },
      { name: 'Config',        type: sql.NVarChar(sql.MAX), value: patch.config ? JSON.stringify(patch.config) : null },
      { name: 'TargetListId',  type: sql.UniqueIdentifier, value: patch.targetListId ?? null },
      { name: 'FieldMapping',  type: sql.NVarChar(sql.MAX), value: patch.fieldMapping ? JSON.stringify(patch.fieldMapping) : null },
      { name: 'TemplateId',    type: sql.UniqueIdentifier, value: clearTemplate ? null : (patch.templateId ?? null) },
      { name: 'ClearTemplate', type: sql.Bit,              value: clearTemplate ? 1 : 0 },
      { name: 'IsPublic',      type: sql.Bit,              value: patch.isPublic == null ? null : (patch.isPublic ? 1 : 0) },
      { name: 'PublicSlug',    type: sql.NVarChar(64),     value: clearSlug ? null : (patch.publicSlug ?? null) },
      { name: 'ClearSlug',     type: sql.Bit,              value: clearSlug ? 1 : 0 },
      { name: 'AuthRequired',  type: sql.Bit,              value: patch.authRequired == null ? null : (patch.authRequired ? 1 : 0) },
    ]);
    return rows[0] ? rowToForm(rows[0]) : null;
  }

  async getById(id: string): Promise<Form | null> {
    const rows = await execSpOne<FormRow>('usp_Form_GetById', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ? rowToForm(rows[0]) : null;
  }

  async getBySlug(slug: string): Promise<Form | null> {
    const rows = await execSpOne<FormRow>('usp_Form_GetBySlug', [
      { name: 'PublicSlug', type: sql.NVarChar(64), value: slug },
    ]);
    return rows[0] ? rowToForm(rows[0]) : null;
  }

  async getWorkspaceId(id: string): Promise<string | null> {
    const rows = await execSpOne<{ WorkspaceId: string }>('usp_Form_GetWorkspaceId', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0]?.WorkspaceId ?? null;
  }

  async list(workspaceId: string, scopeType: string | null, scopeId: string | null): Promise<Form[]> {
    const rows = await execSpOne<FormRow>('usp_Form_List', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'ScopeType',   type: sql.NVarChar(8),      value: scopeType ?? null },
      { name: 'ScopeId',     type: sql.UniqueIdentifier, value: scopeId ?? null },
    ]);
    return Array.from(rows).map(rowToForm);
  }

  async delete(id: string): Promise<Form | null> {
    const rows = await execSpOne<FormRow>('usp_Form_Delete', [
      { name: 'Id', type: sql.UniqueIdentifier, value: id },
    ]);
    return rows[0] ? rowToForm(rows[0]) : null;
  }

  async createSubmission(
    id: string, formId: string, answers: Record<string, unknown>,
    createdTaskId: string | null, submittedById: string | null,
  ): Promise<FormSubmission> {
    const rows = await execSpOne<SubmissionRow>('usp_FormSubmission_Create', [
      { name: 'Id',            type: sql.UniqueIdentifier, value: id },
      { name: 'FormId',        type: sql.UniqueIdentifier, value: formId },
      { name: 'Answers',       type: sql.NVarChar(sql.MAX), value: JSON.stringify(answers) },
      { name: 'CreatedTaskId', type: sql.UniqueIdentifier, value: createdTaskId ?? null },
      { name: 'SubmittedById', type: sql.UniqueIdentifier, value: submittedById ?? null },
    ]);
    return rowToSubmission(rows[0]);
  }

  async listSubmissions(formId: string): Promise<FormSubmission[]> {
    const rows = await execSpOne<SubmissionRow>('usp_FormSubmission_ListByForm', [
      { name: 'FormId', type: sql.UniqueIdentifier, value: formId },
    ]);
    return Array.from(rows).map(rowToSubmission);
  }
}

export const formRepository = new FormRepository();
