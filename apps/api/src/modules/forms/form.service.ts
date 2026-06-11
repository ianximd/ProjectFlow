import { randomUUID, createHmac } from 'node:crypto';
import { FormRepository, formRepository } from './form.repository.js';
import { evalVisibility, validateAnswers, stripHiddenAnswers } from './form.branching.js';
import { mapAnswersToTask } from './form.mapping.js';
import {
  FormNotFoundError, FormNotPublicError, FormAuthRequiredError, FormValidationError,
} from './form.errors.js';
import { TaskService } from '../tasks/task.service.js';
import { TaskRepository } from '../tasks/task.repository.js';
import { ListRepository } from '../hierarchy/list.repository.js';
import { customFieldService } from '../customfields/customfield.service.js';
import { templateService } from '../templates/template.service.js';
import { publishTaskEvent } from '../../graphql/task-events.js';
import { JWT_SECRET } from '../../shared/lib/jwtSecret.js';
import { subLogger } from '../../shared/lib/logger.js';
import type {
  Form, FormSubmission, PublicFormView, CreateFormInput, UpdateFormInput, SubmitFormResult,
} from '@projectflow/types';

const log = subLogger('forms');

/**
 * The public render token is a stateless HMAC of the form id (NOT a secret —
 * the form is public). It binds a submit to a render of THIS form so a stray
 * POST to /forms/public/:slug/submit must carry a token minted for that slug.
 * No DB row, no expiry beyond the form's lifetime — hardening (rate-limit,
 * captcha, expiry) is the Phase 12 follow-up logged in DECISIONS.
 */
function mintReadToken(formId: string): string {
  return createHmac('sha256', JWT_SECRET).update(`form:${formId}`).digest('base64url');
}
function verifyReadToken(formId: string, token: string): boolean {
  const expected = mintReadToken(formId);
  return token.length === expected.length && token === expected;
}

export class FormService {
  private listRepo = new ListRepository();
  private taskService = new TaskService(new TaskRepository());

  constructor(private repo: FormRepository = formRepository) {}

  // ─── CRUD ────────────────────────────────────────────────────────────────
  create(input: CreateFormInput, actorId: string): Promise<Form> {
    return this.repo.create(randomUUID().toUpperCase(), input, actorId);
  }
  update(id: string, patch: UpdateFormInput): Promise<Form | null> {
    return this.repo.update(id, patch);
  }
  getById(id: string): Promise<Form | null> { return this.repo.getById(id); }
  list(workspaceId: string, scopeType: string | null, scopeId: string | null): Promise<Form[]> {
    return this.repo.list(workspaceId, scopeType, scopeId);
  }
  delete(id: string): Promise<Form | null> { return this.repo.delete(id); }
  getWorkspaceId(id: string): Promise<string | null> { return this.repo.getWorkspaceId(id); }
  listSubmissions(formId: string): Promise<FormSubmission[]> { return this.repo.listSubmissions(formId); }

  // ─── Public render (unauthenticated) ─────────────────────────────────────
  /** Resolve a public form by slug into a render payload + a scoped read token. */
  async renderPublic(slug: string): Promise<PublicFormView> {
    const form = await this.repo.getBySlug(slug);
    if (!form) throw new FormNotFoundError();
    if (!form.isPublic) throw new FormNotPublicError();
    return {
      id:           form.id,
      name:         form.name,
      config:       form.config,
      authRequired: form.authRequired,
      readToken:    mintReadToken(form.id),
    };
  }

  // ─── Submit ──────────────────────────────────────────────────────────────
  /**
   * Validate answers against config + branching, then create a task in the
   * form's TargetListId with the mapped fields (+ optional template), and record
   * a FormSubmissions row. `actorId` is null for an anonymous public submit;
   * when the form is AuthRequired, a null actor is rejected.
   */
  async submit(
    slug: string,
    answers: Record<string, unknown>,
    readToken: string,
    actorId: string | null,
  ): Promise<SubmitFormResult> {
    const form = await this.repo.getBySlug(slug);
    if (!form) throw new FormNotFoundError();
    if (!form.isPublic) throw new FormNotPublicError();
    if (!verifyReadToken(form.id, readToken)) throw new FormNotFoundError();
    if (form.authRequired && !actorId) throw new FormAuthRequiredError();

    // Validate (required-on-visible + unknown-key rejection), then drop hidden
    // answers so a branched-away value never persists or maps onto the task.
    const validation = validateAnswers(form.config, answers);
    if (!validation.ok) throw new FormValidationError({ missing: validation.missing, unknown: validation.unknown });
    const cleanAnswers = stripHiddenAnswers(form.config, answers);

    // Map answers → native task fields + custom-field values.
    const mapped = mapAnswersToTask(form.fieldMapping, cleanAnswers);

    // The reporter is the submitter when authed, else the form's creator (a real
    // Users row — Tasks.ReporterId is NOT NULL — so anonymous submits attribute
    // to the form owner).
    const reporterId = actorId ?? form.createdById;

    // Resolve projectId + workspaceId from the TARGET LIST (authoritative) —
    // mirrors docs.service.createTaskFromSelection. A Form stores only
    // workspaceId + targetListId, but a Task needs a projectId (= the list's
    // SpaceId), so it MUST be derived here, not taken from the form.
    const [listWorkspaceId, listRow] = await Promise.all([
      this.listRepo.getWorkspaceId(form.targetListId),
      this.listRepo.getById(form.targetListId),
    ]);
    if (!listWorkspaceId) throw new FormNotFoundError();
    // SpaceId on the list row is the project (Space) id (PascalCase SELECT * row).
    const projectId: string = (listRow as any)?.SpaceId ?? (listRow as any)?.spaceId ?? listWorkspaceId;

    const task = await this.taskService.createTask(
      {
        projectId,
        workspaceId: listWorkspaceId,
        listId:      form.targetListId,
        title:       mapped.taskFields.title,
        description: mapped.taskFields.description ?? null,
        priority:    mapped.taskFields.priority ?? undefined,
        reporterId,
      },
      reporterId,
    );
    // createTask returns the raw usp_Task_Create SELECT * row (PascalCase, no
    // mapper), so the camelCase task.id is undefined at runtime — read tolerantly.
    const createdTaskId: string = (task as any).Id ?? (task as any).id;

    // Mapped custom-field values (best-effort; a bad mapping logs, never faults
    // the whole submit).
    for (const cf of mapped.customFieldValues) {
      try {
        await customFieldService.setValue(createdTaskId, cf.fieldId, cf.value);
      } catch (err) {
        log.warn({ err: (err as Error).message, field: cf.fieldId }, 'submit: custom-field set failed');
      }
    }

    // Optional Phase 5d task template — applied INTO the target list. Best-effort
    // (templates are additive).
    if (form.templateId) {
      try {
        await templateService.apply(
          form.templateId,
          { targetParentId: form.targetListId, anchorDate: new Date().toISOString() },
          reporterId,
        );
      } catch (err) {
        log.warn({ err: (err as Error).message, template: form.templateId }, 'submit: template apply failed');
      }
    }

    // Live boards/views react to the new task.
    if (projectId) {
      await publishTaskEvent('created', { projectId, task }).catch(() => {});
    }

    const submission = await this.repo.createSubmission(
      randomUUID().toUpperCase(), form.id, cleanAnswers, createdTaskId, actorId,
    );
    return { submissionId: submission.id, createdTaskId };
  }

  /** Per-answer visibility for a config (exposed for parity tests / debugging). */
  visibility(form: Form, answers: Record<string, unknown>): Record<string, boolean> {
    return evalVisibility(form.config, answers);
  }
}

export const formService = new FormService();
