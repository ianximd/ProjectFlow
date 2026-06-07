# Phase 7c — Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Forms intake subsystem: a form **builder** (drag field types + conditional show/hide branching over prior answers + target-list + field→task mapping + optional Phase 5d task template), a **public renderer** (link/iframe) that evaluates branching client-side and posts a submission, and a backend that on submit **validates against the form config + branching, creates a task in the form's `TargetListId` with the configured `FieldMapping` (+ optional `template.service.apply`), and records a `FormSubmissions` row**. The public render + submit pair is the ONLY unauthenticated surface (scoped read token, optional `AuthRequired`).

**Architecture:** A new `forms` module (`apps/api/src/modules/forms/`) follows the repo's SP-per-op shape: `Forms`/`FormSubmissions` tables (`0042_forms.sql`), SPs in `infra/sql/procedures/` deployed by `scripts/db-deploy-sps.ts`, a `form.repository` → `form.service`, a Hono **REST** surface (primary) and a GraphQL **mirror** (`form.schema.ts`) over the one shared service. Form `Config` (fields[] + branching) and `FieldMapping` are stored as `NVARCHAR(MAX)` JSON (mirrors `SavedViews.Config`, `Templates.Snapshot`, `TaskRecurrence.rule`). Submit composes EXISTING create paths: `TaskRepository.create` for the task in `TargetListId`, `customFieldService.setValue` for mapped custom fields, and `templateService.apply` for the optional template — it never touches a table directly. Two pure helpers carry the load-bearing logic and are unit-tested: a **branching evaluator** (`evalVisibility` — which fields are visible given prior answers) and a **field→task mapper** (`mapAnswersToTask` — split answers into native task fields vs custom-field id values per `FieldMapping`). The **public render/submit** pair is mounted in a `/forms` route group whose public sub-paths (`GET /forms/public/:slug`, `POST /forms/public/:slug/submit`) deliberately bypass `authMiddleware` (the same "no `app.use('/forms/*', authMiddleware)`; gate each protected handler inline" pattern git-webhooks/avatars already use); a scoped, non-secret read token returned by render is echoed back on submit. Frontend: a `FormBuilder` client component (drag field-type palette, branching-rule editor, target-list + mapping + template pickers) under the protected `(app)` group, and a `PublicFormRenderer` page at `app/forms/[slug]/` — **outside `(app)`** so it renders without a session, evaluating branching client-side via the shared pure evaluator and POSTing the submission.

**Tech Stack:** SQL Server stored procedures (`CREATE OR ALTER`, `SET NOCOUNT ON`, TRY/CATCH/TRANSACTION, `SELECT *` of affected rows); Hono REST + `@hono/zod-validator`; graphql-yoga + Pothos (`@pothos/core`); `mssql` via `execSp`/`execSpOne`; vitest (`--project unit` / `--project integration`); Next.js App Router (SSR, **v16.2.7 — read `node_modules/next/dist/docs/` first**) + `next-intl` (en+id); Playwright e2e (repo-root `e2e/`). DB work runs ONLY against local Docker `ProjectFlow_Test`.

**Prerequisite:** Phases 1–6 merged; Phase 5d `template.service` exists. (7c is independent of the 7a/7b CRDT stack.)

---

## File Structure

**Migrations**
- `infra/sql/migrations/0042_forms.sql` — **Create.** Idempotent, GO-batched: `Forms` (`Config`/`FieldMapping` JSON, `TargetListId`, `TemplateId` NULL, `IsPublic`/`PublicSlug`/`AuthRequired`, soft-delete) + a filtered unique index on `PublicSlug`; `FormSubmissions` (`Answers` JSON, `CreatedTaskId` NULL, `SubmittedById` NULL, `SubmittedAt`).
- `infra/sql/migrations/rollback/0042_forms.down.sql` — **Create.** Reverse: drop `FormSubmissions`, then `Forms` (its index drops with it).

**Stored procedures** (`infra/sql/procedures/`)
- `usp_Form_Create.sql` — **Create.** Insert a form, return `SELECT *`.
- `usp_Form_Update.sql` — **Create.** ISNULL-coalesced patch of config/mapping/target/template/public flags; return `SELECT *`.
- `usp_Form_GetById.sql` — **Create.** Return one live form (`DeletedAt IS NULL`).
- `usp_Form_GetBySlug.sql` — **Create.** Return one live, **public** form by `PublicSlug` (for the unauthenticated render).
- `usp_Form_GetWorkspaceId.sql` — **Create.** Resolve a form's `WorkspaceId` (REST/GraphQL authz).
- `usp_Form_List.sql` — **Create.** List a workspace's live forms (optionally narrowed by `ScopeType`/`ScopeId`).
- `usp_Form_Delete.sql` — **Create.** Soft-delete (set `DeletedAt`), return the row.
- `usp_FormSubmission_Create.sql` — **Create.** Insert a `FormSubmissions` row (answers + created task id + submitter), return `SELECT *`.
- `usp_FormSubmission_ListByForm.sql` — **Create.** List a form's submissions (newest first).

**API** (`apps/api/src/modules/forms/`)
- `form.branching.ts` — **Create.** Pure `evalVisibility` (show/hide over prior answers) + `validateAnswers` (required visible fields filled) + types. No DB.
- `form.mapping.ts` — **Create.** Pure `mapAnswersToTask` (answers + `FieldMapping` → `{ taskFields, customFieldValues }`). No DB.
- `form.repository.ts` — **Create.** `execSp`/`execSpOne` wrappers over the form + submission SPs; row→DTO mapping.
- `form.service.ts` — **Create.** CRUD; `renderPublic(slug)` (read token); `submit(slug, answers, token, actorId|null)` — validate → create task in `TargetListId` → map fields → optional `templateService.apply` → record submission.
- `form.errors.ts` — **Create.** `FormNotFoundError`, `FormNotPublicError`, `FormAuthRequiredError`, `FormValidationError`, `FormSlugTakenError`.
- `form.routes.ts` — **Create.** **Protected** CRUD (`POST/GET/PUT/DELETE /forms`, `GET /forms/:id/submissions`) gated inline by object-level ACL on the form's `ScopeId`; **public** `GET /forms/public/:slug` + `POST /forms/public/:slug/submit` that bypass auth.

**API wiring**
- `apps/api/src/server.ts` — **Modify.** Import `formRoutes`; mount `app.route('/forms', formRoutes)`. **DO NOT** add `app.use('/forms/*', authMiddleware)` — protected handlers gate inline; the `/forms/public/*` pair stays unauthenticated.
- `apps/api/src/graphql/form.schema.ts` — **Create.** `registerFormsGraphql()`: `FormType`/`FormSubmissionType` + `forms`/`form`/`formSubmissions` queries + `createForm`/`updateForm`/`deleteForm` mutations (mirror over the shared service; **public render/submit stay REST-only**).
- `apps/api/src/graphql/schema.ts` — **Modify.** Import + call `registerFormsGraphql()` near the other `register*Graphql()` calls (~line 768).

**Types** (`packages/types/`)
- `index.ts` — **Modify.** Add `FormFieldType`, `FormField`, `FormBranchingRule`, `FormConfig`, `FormFieldMapping`, `Form`, `FormSubmission`, `PublicFormView`, `CreateFormInput`, `UpdateFormInput`, `SubmitFormInput`, `SubmitFormResult`.

**Frontend** (`apps/next-web/src/`)
- `server/actions/forms.ts` — **Create.** Authed CRUD server actions (`createForm`/`updateForm`/`deleteForm`/`listForms`/`getForm`/`listSubmissions`).
- `server/public/forms.ts` — **Create.** UNauthenticated fetch helpers for the public render + submit (no `requireSession`; talk to the API directly, NOT via `serverFetch` which redirects on 401).
- `lib/formBranching.ts` — **Create.** Client copy of the pure `evalVisibility`/`validateAnswers` (shared logic; identical to `form.branching.ts`, no server-only imports) so the public renderer evaluates branching client-side.
- `lib/__tests__/formBranching.unit.test.ts` — **Create.** Unit tests for the client branching evaluator (mirrors the API unit tests).
- `components/forms/FormBuilder.tsx` — **Create.** Builder: drag field-type palette, per-field config, branching-rule editor, target-list + field-mapping + template pickers; save via server action.
- `components/forms/FormBuilder.module.css` — **Create.** Builder styles.
- `components/forms/PublicFormRenderer.tsx` — **Create.** Client renderer: evaluates branching live, renders only visible fields, validates, POSTs the submission, shows a success state.
- `components/forms/PublicFormRenderer.module.css` — **Create.** Renderer styles.
- `app/(app)/forms/page.tsx` — **Create.** Forms list (authed) for the active workspace.
- `app/(app)/forms/[id]/page.tsx` — **Create.** Builder page (authed) — loads a form + lists, mounts `<FormBuilder/>`.
- `app/forms/[slug]/page.tsx` — **Create. OUTSIDE `(app)`.** Public render route — fetches the public form (no session), mounts `<PublicFormRenderer/>`.
- `messages/en.json` — **Modify.** New `Forms` namespace.
- `messages/id.json` — **Modify.** Same keys, real Indonesian.

**Tests**
- `apps/api/src/modules/forms/__tests__/branching.unit.test.ts` — **Create.** Pure show/hide evaluation + required-visible validation.
- `apps/api/src/modules/forms/__tests__/mapping.unit.test.ts` — **Create.** Pure field→task mapping (native vs custom-field split; unmapped dropped).
- `apps/api/src/modules/forms/__tests__/forms.integration.test.ts` — **Create.** submit → task created in `TargetListId` with mapped fields (+ template applied); auth-required form rejects anonymous submit; hidden-required field is NOT enforced.
- `e2e/forms.spec.ts` — **Create. (repo-root `e2e/`.)** Headline: a conditional-logic form hides/shows questions and creates a task on submit.

---

## Tasks

### Task 1: Migration + rollback (`0042_forms.sql`)

**Files:**
- Create: `infra/sql/migrations/0042_forms.sql`
- Create: `infra/sql/migrations/rollback/0042_forms.down.sql`
- Test: manual deploy against local Docker `ProjectFlow_Test` (migrations have no unit harness; verified via the integration suite in Task 7).

Steps:

- [ ] Write the migration. Idempotent (`sys.tables` / `sys.indexes` guards), GO-batched, matching the `0032`/`0037` style. Exact columns from spec §6.1:

```sql
-- =============================================================================
-- Migration 0042: Forms (Phase 7c — intake)
-- Two tables:
--   * Forms — one intake form. Config (fields[] + branching) and FieldMapping
--     (form field -> task field / custom-field id) are JSON in NVARCHAR(MAX),
--     mirroring SavedViews.Config / Templates.Snapshot. TargetListId is the list
--     a submission's task is created in; TemplateId optionally applies a Phase 5d
--     task template on submit. Public surface: IsPublic + PublicSlug (unique while
--     live) + AuthRequired. Soft-delete via DeletedAt.
--   * FormSubmissions — one row per submit. Answers JSON, CreatedTaskId (the task
--     the submission spawned), SubmittedById (NULL for anonymous public submits).
-- Idempotent (catalog guards), GO-batched.
-- Rollback in rollback/0042_forms.down.sql.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Forms')
BEGIN
    CREATE TABLE dbo.Forms (
        Id           UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId  UNIQUEIDENTIFIER NOT NULL,
        ScopeType    NVARCHAR(8)      NOT NULL,   -- 'SPACE' | 'FOLDER' | 'LIST'
        ScopeId      UNIQUEIDENTIFIER NOT NULL,
        Name         NVARCHAR(255)    NOT NULL,
        Config       NVARCHAR(MAX)    NOT NULL,   -- JSON: { fields:[...], branching:[...] }
        TargetListId UNIQUEIDENTIFIER NOT NULL,
        FieldMapping NVARCHAR(MAX)    NOT NULL,   -- JSON: { <formFieldKey>: { kind, target } }
        TemplateId   UNIQUEIDENTIFIER NULL,       -- optional Phase 5d task template
        IsPublic     BIT              NOT NULL CONSTRAINT DF_Forms_IsPublic     DEFAULT 0,
        PublicSlug   NVARCHAR(64)     NULL,
        AuthRequired BIT              NOT NULL CONSTRAINT DF_Forms_AuthRequired DEFAULT 0,
        CreatedById  UNIQUEIDENTIFIER NOT NULL,
        CreatedAt    DATETIME2        NOT NULL CONSTRAINT DF_Forms_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt    DATETIME2        NOT NULL CONSTRAINT DF_Forms_UpdatedAt DEFAULT SYSUTCDATETIME(),
        DeletedAt    DATETIME2        NULL,
        CONSTRAINT CK_Forms_Scope CHECK (ScopeType IN ('SPACE','FOLDER','LIST')),
        CONSTRAINT FK_Forms_Workspace FOREIGN KEY (WorkspaceId) REFERENCES dbo.Workspaces(Id),
        CONSTRAINT FK_Forms_TargetList FOREIGN KEY (TargetListId) REFERENCES dbo.Lists(Id),
        CONSTRAINT FK_Forms_CreatedBy  FOREIGN KEY (CreatedById)  REFERENCES dbo.Users(Id)
    );
END
GO

-- A live public form's slug must be globally unique (it's the unauthenticated
-- entry point). Filtered so soft-deleted / non-public rows don't collide.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Forms_PublicSlug' AND object_id = OBJECT_ID('dbo.Forms'))
    CREATE UNIQUE NONCLUSTERED INDEX UQ_Forms_PublicSlug
        ON dbo.Forms (PublicSlug)
        WHERE PublicSlug IS NOT NULL AND DeletedAt IS NULL;
GO

-- Form Center cover: a workspace's live forms, optionally narrowed by scope.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Forms_Workspace_Scope' AND object_id = OBJECT_ID('dbo.Forms'))
    CREATE NONCLUSTERED INDEX IX_Forms_Workspace_Scope
        ON dbo.Forms (WorkspaceId, ScopeType, ScopeId) WHERE DeletedAt IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FormSubmissions')
BEGIN
    CREATE TABLE dbo.FormSubmissions (
        Id            UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        FormId        UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_FormSubmissions_Form REFERENCES dbo.Forms(Id) ON DELETE CASCADE,
        Answers       NVARCHAR(MAX)    NOT NULL,   -- JSON: { <formFieldKey>: value }
        CreatedTaskId UNIQUEIDENTIFIER NULL
            CONSTRAINT FK_FormSubmissions_Task REFERENCES dbo.Tasks(Id),
        SubmittedById UNIQUEIDENTIFIER NULL        -- NULL = anonymous public submit
            CONSTRAINT FK_FormSubmissions_User REFERENCES dbo.Users(Id),
        SubmittedAt   DATETIME2        NOT NULL CONSTRAINT DF_FormSubmissions_SubmittedAt DEFAULT SYSUTCDATETIME()
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FormSubmissions_Form' AND object_id = OBJECT_ID('dbo.FormSubmissions'))
    CREATE NONCLUSTERED INDEX IX_FormSubmissions_Form ON dbo.FormSubmissions (FormId, SubmittedAt DESC);
GO
```

- [ ] Write the rollback `rollback/0042_forms.down.sql` (reverse order; child table first, then parent; the parent's indexes drop with it):

```sql
-- Rollback 0042: Forms.
-- Drops FormSubmissions (the child) first, then Forms. Each table's indexes +
-- constraints drop with it.

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FormSubmissions') DROP TABLE dbo.FormSubmissions;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Forms')           DROP TABLE dbo.Forms;
GO
```

- [ ] Run against local Docker `ProjectFlow_Test` only (explicit local DB env, never `apps/api/.env`). Apply `0042_forms.sql`, then immediately the `.down.sql`, then re-apply `0042` to prove idempotency + reversibility. Expected: all three runs succeed with no errors; the second `0042` apply is a clean no-op (guards skip everything).

- [ ] Commit:
```
git add infra/sql/migrations/0042_forms.sql infra/sql/migrations/rollback/0042_forms.down.sql
git commit -m "feat(7c): forms migration — Forms (config/mapping/public slug) + FormSubmissions"
```

---

### Task 2: Form CRUD SPs

**Files:**
- Create: `infra/sql/procedures/usp_Form_Create.sql`
- Create: `infra/sql/procedures/usp_Form_Update.sql`
- Create: `infra/sql/procedures/usp_Form_GetById.sql`
- Create: `infra/sql/procedures/usp_Form_GetBySlug.sql`
- Create: `infra/sql/procedures/usp_Form_GetWorkspaceId.sql`
- Create: `infra/sql/procedures/usp_Form_List.sql`
- Create: `infra/sql/procedures/usp_Form_Delete.sql`
- Test: covered by `forms.integration.test.ts` (Task 7); deploy via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`.

Steps:

- [ ] Write `usp_Form_Create.sql` — validate the target list lives in the same workspace (the `usp_List_Create` guard pattern), insert, return `SELECT *`:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Form_Create
    @Id           UNIQUEIDENTIFIER,
    @WorkspaceId  UNIQUEIDENTIFIER,
    @ScopeType    NVARCHAR(8),
    @ScopeId      UNIQUEIDENTIFIER,
    @Name         NVARCHAR(255),
    @Config       NVARCHAR(MAX),
    @TargetListId UNIQUEIDENTIFIER,
    @FieldMapping NVARCHAR(MAX),
    @TemplateId   UNIQUEIDENTIFIER = NULL,
    @IsPublic     BIT             = 0,
    @PublicSlug   NVARCHAR(64)    = NULL,
    @AuthRequired BIT             = 0,
    @CreatedById  UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.Lists WHERE Id = @TargetListId AND WorkspaceId = @WorkspaceId AND DeletedAt IS NULL)
            THROW 51420, 'Target list not found in workspace', 1;
        IF @TemplateId IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM dbo.Templates WHERE Id = @TemplateId AND WorkspaceId = @WorkspaceId AND DeletedAt IS NULL)
            THROW 51421, 'Template not found in workspace', 1;

        INSERT INTO dbo.Forms
            (Id, WorkspaceId, ScopeType, ScopeId, Name, Config, TargetListId, FieldMapping,
             TemplateId, IsPublic, PublicSlug, AuthRequired, CreatedById)
        VALUES
            (@Id, @WorkspaceId, @ScopeType, @ScopeId, @Name, @Config, @TargetListId, @FieldMapping,
             @TemplateId, @IsPublic, @PublicSlug, @AuthRequired, @CreatedById);

        SELECT * FROM dbo.Forms WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
GO
```

- [ ] Write `usp_Form_Update.sql` — ISNULL-coalesced patch (NULL args leave a column unchanged), with explicit clear flags for the optional `TemplateId`/`PublicSlug`, bump `UpdatedAt`, return `SELECT *`:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Form_Update
    @Id            UNIQUEIDENTIFIER,
    @Name          NVARCHAR(255) = NULL,
    @Config        NVARCHAR(MAX) = NULL,
    @TargetListId  UNIQUEIDENTIFIER = NULL,
    @FieldMapping  NVARCHAR(MAX) = NULL,
    @TemplateId    UNIQUEIDENTIFIER = NULL,
    @ClearTemplate BIT = 0,
    @IsPublic      BIT = NULL,
    @PublicSlug    NVARCHAR(64) = NULL,
    @ClearSlug     BIT = 0,
    @AuthRequired  BIT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        UPDATE dbo.Forms SET
            Name         = ISNULL(@Name,         Name),
            Config       = ISNULL(@Config,       Config),
            TargetListId = ISNULL(@TargetListId, TargetListId),
            FieldMapping = ISNULL(@FieldMapping, FieldMapping),
            TemplateId   = CASE WHEN @ClearTemplate = 1 THEN NULL ELSE ISNULL(@TemplateId, TemplateId) END,
            IsPublic     = ISNULL(@IsPublic,     IsPublic),
            PublicSlug   = CASE WHEN @ClearSlug = 1 THEN NULL ELSE ISNULL(@PublicSlug, PublicSlug) END,
            AuthRequired = ISNULL(@AuthRequired, AuthRequired),
            UpdatedAt    = SYSUTCDATETIME()
        WHERE Id = @Id AND DeletedAt IS NULL;

        SELECT * FROM dbo.Forms WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
GO
```

- [ ] Write `usp_Form_GetById.sql`:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Form_GetById
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.Forms WHERE Id = @Id AND DeletedAt IS NULL;
END;
GO
```

- [ ] Write `usp_Form_GetBySlug.sql` — the unauthenticated render reads here; only a LIVE, PUBLIC form resolves:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Form_GetBySlug
    @PublicSlug NVARCHAR(64)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.Forms
    WHERE PublicSlug = @PublicSlug AND IsPublic = 1 AND DeletedAt IS NULL;
END;
GO
```

- [ ] Write `usp_Form_GetWorkspaceId.sql`:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Form_GetWorkspaceId
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT WorkspaceId FROM dbo.Forms WHERE Id = @Id AND DeletedAt IS NULL;
END;
GO
```

- [ ] Write `usp_Form_List.sql` — a workspace's live forms, optionally narrowed by scope:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Form_List
    @WorkspaceId UNIQUEIDENTIFIER,
    @ScopeType   NVARCHAR(8)      = NULL,
    @ScopeId     UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.Forms
    WHERE WorkspaceId = @WorkspaceId
      AND DeletedAt IS NULL
      AND (@ScopeType IS NULL OR ScopeType = @ScopeType)
      AND (@ScopeId   IS NULL OR ScopeId   = @ScopeId)
    ORDER BY CreatedAt DESC;
END;
GO
```

- [ ] Write `usp_Form_Delete.sql` — soft-delete, return the row:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Form_Delete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.Forms SET DeletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
    WHERE Id = @Id AND DeletedAt IS NULL;
    SELECT * FROM dbo.Forms WHERE Id = @Id;
END;
GO
```

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test` (local DB env only). Expected: all seven procedures created with no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_Form_Create.sql infra/sql/procedures/usp_Form_Update.sql infra/sql/procedures/usp_Form_GetById.sql infra/sql/procedures/usp_Form_GetBySlug.sql infra/sql/procedures/usp_Form_GetWorkspaceId.sql infra/sql/procedures/usp_Form_List.sql infra/sql/procedures/usp_Form_Delete.sql
git commit -m "feat(7c): form CRUD SPs — Create/Update/GetById/GetBySlug/GetWorkspaceId/List/Delete"
```

---

### Task 3: Submission SPs (`FormSubmission_Create`, `FormSubmission_ListByForm`)

**Files:**
- Create: `infra/sql/procedures/usp_FormSubmission_Create.sql`
- Create: `infra/sql/procedures/usp_FormSubmission_ListByForm.sql`
- Test: covered by `forms.integration.test.ts` (Task 7); deploy via `scripts/db-deploy-sps.ts`.

Steps:

- [ ] Write `usp_FormSubmission_Create.sql` — record a submission (the task is already created by the service via `usp_Task_Create`; this only persists the audit row), return `SELECT *`:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_FormSubmission_Create
    @Id            UNIQUEIDENTIFIER,
    @FormId        UNIQUEIDENTIFIER,
    @Answers       NVARCHAR(MAX),
    @CreatedTaskId UNIQUEIDENTIFIER = NULL,
    @SubmittedById UNIQUEIDENTIFIER = NULL   -- NULL for anonymous public submits
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        INSERT INTO dbo.FormSubmissions (Id, FormId, Answers, CreatedTaskId, SubmittedById)
        VALUES (@Id, @FormId, @Answers, @CreatedTaskId, @SubmittedById);

        SELECT * FROM dbo.FormSubmissions WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
GO
```

- [ ] Write `usp_FormSubmission_ListByForm.sql`:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_FormSubmission_ListByForm
    @FormId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.FormSubmissions
    WHERE FormId = @FormId
    ORDER BY SubmittedAt DESC;
END;
GO
```

- [ ] Run: deploy SPs via `scripts/db-deploy-sps.ts` against `ProjectFlow_Test`. Expected: both procedures created with no errors.

- [ ] Commit:
```
git add infra/sql/procedures/usp_FormSubmission_Create.sql infra/sql/procedures/usp_FormSubmission_ListByForm.sql
git commit -m "feat(7c): submission SPs — FormSubmission_Create + FormSubmission_ListByForm"
```

---

### Task 4: Types + pure helpers (branching + mapping) + unit tests

**Files:**
- Modify: `packages/types/index.ts`
- Create: `apps/api/src/modules/forms/form.branching.ts`
- Create: `apps/api/src/modules/forms/form.mapping.ts`
- Create: `apps/api/src/modules/forms/__tests__/branching.unit.test.ts`
- Create: `apps/api/src/modules/forms/__tests__/mapping.unit.test.ts`

Steps:

- [ ] Extend `packages/types/index.ts` — add the Forms block (append near the other Phase-7-adjacent blocks):

```ts
// ── Forms (Phase 7c — intake) ─────────────────────────────────────────────────

export type FormFieldType =
  | 'short_text' | 'long_text' | 'number' | 'email'
  | 'select' | 'multiselect' | 'checkbox' | 'date';

export interface FormField {
  key:       string;            // stable key (answers + mapping + branching reference this)
  label:     string;
  type:      FormFieldType;
  required:  boolean;
  options?:  string[];          // for select / multiselect
  placeholder?: string;
}

/** Show/hide a field when a PRIOR field's answer matches. Default = visible. */
export interface FormBranchingRule {
  fieldKey: string;             // the field this rule controls
  action:   'show' | 'hide';
  when:     {
    fieldKey: string;           // a field that appears EARLIER in fields[]
    op:       'equals' | 'not_equals' | 'includes' | 'is_empty' | 'is_not_empty';
    value?:   string;
  };
}

export interface FormConfig {
  fields:    FormField[];
  branching: FormBranchingRule[];
}

/** form field key -> where its answer lands on the created task. */
export type FormFieldMapping = Record<string, FormFieldMappingTarget>;
export interface FormFieldMappingTarget {
  kind:   'task' | 'custom_field';
  target: string;               // task: 'title'|'description'|'priority'; custom_field: the field id
}

export interface Form {
  id:           string;
  workspaceId:  string;
  scopeType:    'SPACE' | 'FOLDER' | 'LIST';
  scopeId:      string;
  name:         string;
  config:       FormConfig;
  targetListId: string;
  fieldMapping: FormFieldMapping;
  templateId:   string | null;
  isPublic:     boolean;
  publicSlug:   string | null;
  authRequired: boolean;
  createdById:  string;
  createdAt:    string;
  updatedAt:    string;
}

export interface FormSubmission {
  id:            string;
  formId:        string;
  answers:       Record<string, unknown>;
  createdTaskId: string | null;
  submittedById: string | null;
  submittedAt:   string;
}

/** The unauthenticated render payload (no internal ids leaked beyond config). */
export interface PublicFormView {
  id:           string;
  name:         string;
  config:       FormConfig;
  authRequired: boolean;
  readToken:    string;         // scoped, echoed back on submit
}

export interface CreateFormInput {
  workspaceId:  string;
  scopeType:    'SPACE' | 'FOLDER' | 'LIST';
  scopeId:      string;
  name:         string;
  config:       FormConfig;
  targetListId: string;
  fieldMapping: FormFieldMapping;
  templateId?:  string | null;
  isPublic?:    boolean;
  publicSlug?:  string | null;
  authRequired?: boolean;
}

export interface UpdateFormInput {
  name?:         string;
  config?:       FormConfig;
  targetListId?: string;
  fieldMapping?: FormFieldMapping;
  templateId?:   string | null;   // null clears
  isPublic?:     boolean;
  publicSlug?:   string | null;    // null clears
  authRequired?: boolean;
}

export interface SubmitFormInput {
  answers:   Record<string, unknown>;
  readToken: string;
}

export interface SubmitFormResult {
  submissionId:  string;
  createdTaskId: string | null;
}
```

- [ ] Write the failing branching unit test first. `apps/api/src/modules/forms/__tests__/branching.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { evalVisibility, validateAnswers } from '../form.branching.js';
import type { FormConfig } from '@projectflow/types';

const config: FormConfig = {
  fields: [
    { key: 'kind',    label: 'Kind',    type: 'select',     required: true,  options: ['bug', 'idea'] },
    { key: 'steps',   label: 'Steps',   type: 'long_text',  required: true },
    { key: 'votes',   label: 'Votes',   type: 'number',     required: false },
  ],
  branching: [
    // "steps" only shows for bug reports; "votes" only for ideas.
    { fieldKey: 'steps', action: 'show', when: { fieldKey: 'kind', op: 'equals', value: 'bug'  } },
    { fieldKey: 'votes', action: 'show', when: { fieldKey: 'kind', op: 'equals', value: 'idea' } },
  ],
};

describe('evalVisibility', () => {
  it('shows a field whose show-rule matches and hides it otherwise', () => {
    const bug  = evalVisibility(config, { kind: 'bug' });
    expect(bug.steps).toBe(true);
    expect(bug.votes).toBe(false);

    const idea = evalVisibility(config, { kind: 'idea' });
    expect(idea.steps).toBe(false);
    expect(idea.votes).toBe(true);
  });

  it('treats an unruled field as always visible', () => {
    expect(evalVisibility(config, {}).kind).toBe(true);
  });

  it('hides via an explicit hide-rule when its condition matches', () => {
    const cfg: FormConfig = {
      fields: [
        { key: 'a', label: 'A', type: 'checkbox', required: false },
        { key: 'b', label: 'B', type: 'short_text', required: false },
      ],
      branching: [{ fieldKey: 'b', action: 'hide', when: { fieldKey: 'a', op: 'equals', value: 'true' } }],
    };
    expect(evalVisibility(cfg, { a: 'true' }).b).toBe(false);
    expect(evalVisibility(cfg, { a: 'false' }).b).toBe(true);
  });
});

describe('validateAnswers', () => {
  it('passes when every VISIBLE required field is filled', () => {
    const r = validateAnswers(config, { kind: 'bug', steps: 'open app, crash' });
    expect(r.ok).toBe(true);
  });

  it('does NOT enforce a required field that branching hid', () => {
    // "steps" is required but hidden for ideas → not enforced.
    const r = validateAnswers(config, { kind: 'idea', votes: 3 });
    expect(r.ok).toBe(true);
  });

  it('fails when a visible required field is empty', () => {
    const r = validateAnswers(config, { kind: 'bug' });   // steps visible + required + missing
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('steps');
  });

  it('rejects an unknown answer key', () => {
    const r = validateAnswers(config, { kind: 'bug', steps: 'x', bogus: 1 });
    expect(r.ok).toBe(false);
    expect(r.unknown).toContain('bogus');
  });
});
```

- [ ] Write the failing mapping unit test. `apps/api/src/modules/forms/__tests__/mapping.unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mapAnswersToTask } from '../form.mapping.js';
import type { FormFieldMapping } from '@projectflow/types';

const mapping: FormFieldMapping = {
  summary:  { kind: 'task', target: 'title' },
  details:  { kind: 'task', target: 'description' },
  urgency:  { kind: 'task', target: 'priority' },
  effort:   { kind: 'custom_field', target: 'FIELD-EFFORT-ID' },
};

describe('mapAnswersToTask', () => {
  it('splits answers into native task fields vs custom-field id values', () => {
    const out = mapAnswersToTask(mapping, {
      summary: 'Login broken',
      details: 'Steps to repro...',
      urgency: 'HIGH',
      effort:  5,
    });
    expect(out.taskFields).toEqual({ title: 'Login broken', description: 'Steps to repro...', priority: 'HIGH' });
    expect(out.customFieldValues).toEqual([{ fieldId: 'FIELD-EFFORT-ID', value: 5 }]);
  });

  it('drops answers with no mapping entry', () => {
    const out = mapAnswersToTask(mapping, { summary: 'X', extra: 'ignored' });
    expect(out.taskFields).toEqual({ title: 'X' });
    expect(out.customFieldValues).toEqual([]);
  });

  it('falls back to a placeholder title when nothing maps to title', () => {
    const out = mapAnswersToTask({ effort: { kind: 'custom_field', target: 'F1' } }, { effort: 2 });
    expect(out.taskFields.title).toBe('Form submission');
    expect(out.customFieldValues).toEqual([{ fieldId: 'F1', value: 2 }]);
  });

  it('ignores null/undefined answer values', () => {
    const out = mapAnswersToTask(mapping, { summary: 'Y', details: null, effort: undefined });
    expect(out.taskFields).toEqual({ title: 'Y' });
    expect(out.customFieldValues).toEqual([]);
  });
});
```

- [ ] Run: `npm test --workspace apps/api -- branching mapping`. Expected: FAIL — `Cannot find module '../form.branching.js'` / `'../form.mapping.js'`.

- [ ] Write `apps/api/src/modules/forms/form.branching.ts` (pure, no DB):

```ts
import type { FormConfig, FormField, FormBranchingRule } from '@projectflow/types';

type Answers = Record<string, unknown>;

/** Stringify a scalar answer for comparison; arrays compare via membership. */
function asString(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(String).join(',');
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

function isEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'string') return v.trim() === '';
  return false;
}

/** Does a single rule's condition hold under the current answers? */
function conditionHolds(rule: FormBranchingRule, answers: Answers): boolean {
  const actual = answers[rule.when.fieldKey];
  switch (rule.when.op) {
    case 'equals':       return asString(actual) === asString(rule.when.value ?? '');
    case 'not_equals':   return asString(actual) !== asString(rule.when.value ?? '');
    case 'includes':     return Array.isArray(actual)
      ? actual.map(String).includes(String(rule.when.value ?? ''))
      : asString(actual).includes(String(rule.when.value ?? ''));
    case 'is_empty':     return isEmpty(actual);
    case 'is_not_empty': return !isEmpty(actual);
    default:             return false;
  }
}

/**
 * Resolve each field's visibility given prior answers. A field with no rule is
 * visible. With rules: the LAST matching rule wins (show → visible, hide →
 * hidden); if rules exist but none match, a `show` rule means the field is
 * hidden by default (it only appears when its condition holds), while a `hide`
 * rule means it stays visible until its condition holds. This is the same logic
 * the public renderer runs client-side (mirrored in lib/formBranching.ts).
 */
export function evalVisibility(config: FormConfig, answers: Answers): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const field of config.fields) {
    const rules = config.branching.filter((r) => r.fieldKey === field.key);
    if (rules.length === 0) { out[field.key] = true; continue; }
    // Default: a show-ruled field starts hidden; a hide-ruled field starts visible.
    let visible = !rules.some((r) => r.action === 'show');
    for (const rule of rules) {
      if (conditionHolds(rule, answers)) visible = rule.action === 'show';
    }
    out[field.key] = visible;
  }
  return out;
}

export interface ValidationResult {
  ok:      boolean;
  missing: string[];   // visible required fields left empty
  unknown: string[];   // answer keys not declared in config.fields
}

/** Required-on-VISIBLE validation + unknown-key rejection. */
export function validateAnswers(config: FormConfig, answers: Answers): ValidationResult {
  const visibility = evalVisibility(config, answers);
  const known = new Set(config.fields.map((f) => f.key));
  const missing: string[] = [];
  for (const field of config.fields) {
    if (!visibility[field.key]) continue;            // hidden → not enforced
    if (field.required && isEmpty(answers[field.key])) missing.push(field.key);
  }
  const unknown = Object.keys(answers).filter((k) => !known.has(k));
  return { ok: missing.length === 0 && unknown.length === 0, missing, unknown };
}

/** Drop answers for fields that branching hid (so hidden values never persist). */
export function stripHiddenAnswers(config: FormConfig, answers: Answers): Answers {
  const visibility = evalVisibility(config, answers);
  const out: Answers = {};
  for (const [k, v] of Object.entries(answers)) {
    if (visibility[k] !== false) out[k] = v;          // keep visible + unknown (rejected upstream)
  }
  return out;
}

export type { FormField };
```

- [ ] Write `apps/api/src/modules/forms/form.mapping.ts` (pure, no DB):

```ts
import type { FormFieldMapping } from '@projectflow/types';

/** Native task columns a form answer may target. */
export interface MappedTaskFields {
  title?:       string;
  description?: string;
  priority?:    string;
}

export interface MappedCustomFieldValue {
  fieldId: string;
  value:   unknown;
}

export interface MappedTask {
  taskFields:        Required<Pick<MappedTaskFields, 'title'>> & MappedTaskFields;
  customFieldValues: MappedCustomFieldValue[];
}

const NATIVE_TARGETS = new Set(['title', 'description', 'priority']);

/**
 * Split form answers into native task fields and custom-field id/value pairs,
 * per the form's FieldMapping. Unmapped answers and null/undefined values are
 * dropped. Title always resolves (placeholder fallback) so the created task is
 * never untitled.
 */
export function mapAnswersToTask(
  mapping: FormFieldMapping,
  answers: Record<string, unknown>,
): MappedTask {
  const taskFields: MappedTaskFields = {};
  const customFieldValues: MappedCustomFieldValue[] = [];

  for (const [answerKey, value] of Object.entries(answers)) {
    if (value == null) continue;
    const target = mapping[answerKey];
    if (!target) continue;
    if (target.kind === 'task') {
      if (NATIVE_TARGETS.has(target.target)) {
        (taskFields as Record<string, unknown>)[target.target] = value;
      }
    } else {
      customFieldValues.push({ fieldId: target.target, value });
    }
  }

  const title = typeof taskFields.title === 'string' && taskFields.title.trim() !== ''
    ? taskFields.title
    : 'Form submission';

  return { taskFields: { ...taskFields, title }, customFieldValues };
}
```

- [ ] Run: `npm test --workspace apps/api -- branching mapping`. Expected: PASS (branching 8 + mapping 4).

- [ ] Run: `npm run build --workspace packages/types` (or the repo's types build) so `@projectflow/types` re-exports the new symbols. Expected: PASS.

- [ ] Commit:
```
git add packages/types/index.ts apps/api/src/modules/forms/form.branching.ts apps/api/src/modules/forms/form.mapping.ts apps/api/src/modules/forms/__tests__/branching.unit.test.ts apps/api/src/modules/forms/__tests__/mapping.unit.test.ts
git commit -m "feat(7c): form types + pure branching evaluator + field-mapping helper + unit tests"
```

---

### Task 5: Repository + service (CRUD + render + submit)

**Files:**
- Create: `apps/api/src/modules/forms/form.errors.ts`
- Create: `apps/api/src/modules/forms/form.repository.ts`
- Create: `apps/api/src/modules/forms/form.service.ts`

Steps:

- [ ] Write `apps/api/src/modules/forms/form.errors.ts`:

```ts
export class FormNotFoundError extends Error {
  code = 'FORM_NOT_FOUND';
  constructor() { super('Form not found'); }
}
export class FormNotPublicError extends Error {
  code = 'FORM_NOT_PUBLIC';
  constructor() { super('Form is not public'); }
}
export class FormAuthRequiredError extends Error {
  code = 'FORM_AUTH_REQUIRED';
  constructor() { super('This form requires sign-in to submit'); }
}
export class FormValidationError extends Error {
  code = 'FORM_VALIDATION';
  constructor(public detail: { missing: string[]; unknown: string[] }) {
    super('Submission failed validation');
  }
}
export class FormSlugTakenError extends Error {
  code = 'FORM_SLUG_TAKEN';
  constructor() { super('Public slug already in use'); }
}
```

- [ ] Write `apps/api/src/modules/forms/form.repository.ts` — `execSp`/`execSpOne` wrappers + a row→`Form` mapper that parses the JSON columns:

```ts
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
```

- [ ] Write `apps/api/src/modules/forms/form.service.ts` — CRUD + the public render + the submit orchestration. Submit composes the EXISTING create paths (`TaskRepository.create`, `customFieldService.setValue`, `templateService.apply`) — never raw SQL:

```ts
import { randomUUID, createHmac } from 'node:crypto';
import { FormRepository, formRepository } from './form.repository.js';
import { evalVisibility, validateAnswers, stripHiddenAnswers } from './form.branching.js';
import { mapAnswersToTask } from './form.mapping.js';
import {
  FormNotFoundError, FormNotPublicError, FormAuthRequiredError, FormValidationError,
} from './form.errors.js';
import { TaskRepository } from '../tasks/task.repository.js';
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
 * captcha, expiry) is the Phase 12 follow-up logged in spec §8.
 */
function mintReadToken(formId: string): string {
  return createHmac('sha256', JWT_SECRET).update(`form:${formId}`).digest('base64url');
}
function verifyReadToken(formId: string, token: string): boolean {
  const expected = mintReadToken(formId);
  return token.length === expected.length && token === expected;
}

export class FormService {
  constructor(
    private repo: FormRepository = formRepository,
    private taskRepo: TaskRepository = new TaskRepository(),
  ) {}

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

    const task = await this.taskRepo.create({
      workspaceId: form.workspaceId,
      listId:      form.targetListId,
      title:       mapped.taskFields.title,
      description: mapped.taskFields.description ?? null,
      priority:    mapped.taskFields.priority ?? undefined,
      reporterId,
    } as any);
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

    // Optional Phase 5d task template — applied INTO the target list as subtasks
    // of the created task's list. Best-effort (templates are additive).
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
    const projectId = (task as any).ProjectId ?? (task as any).projectId;
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
```

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: PASS — no type errors (routes added in Task 6 wire the service; the service itself compiles).

- [ ] Commit:
```
git add apps/api/src/modules/forms/form.errors.ts apps/api/src/modules/forms/form.repository.ts apps/api/src/modules/forms/form.service.ts
git commit -m "feat(7c): form repo + service — CRUD, public render (read token), submit→task+template+submission"
```

---

### Task 6: REST routes (protected CRUD + public render/submit) + server wiring

**Files:**
- Create: `apps/api/src/modules/forms/form.routes.ts`
- Modify: `apps/api/src/server.ts` (import + mount `/forms`; NO blanket `authMiddleware` on `/forms/*`)

Steps:

- [ ] Write `form.routes.ts`. The protected handlers gate inline (object-level ACL on the form's `ScopeId`, mirroring the templates route's inline `accessService.resolveOrNull` + `LEVEL_ORDER` checks); the `/public/:slug` render + submit handlers carry NO auth. The public submit attaches `authMiddleware` ONLY for an authed user opportunistically via a soft optional-auth check (so AuthRequired forms can attribute) — done inline by reading the bearer if present:

```ts
import { Hono } from 'hono';
import type { Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../auth/auth.middleware.js';
import { formService } from './form.service.js';
import {
  FormNotFoundError, FormNotPublicError, FormAuthRequiredError, FormValidationError,
} from './form.errors.js';
import { accessService, LEVEL_ORDER } from '../access/access.service.js';
import { isWorkspaceMember } from '../workspaces/membership.js';
import { JWT_SECRET } from '../../shared/lib/jwtSecret.js';
import type { ObjectPermissionLevel } from '@projectflow/types';

export const formRoutes = new Hono();

function getUserId(c: Context): string | null {
  return (c as any).get('user')?.userId ?? null;
}

const SCOPE = z.enum(['SPACE', 'FOLDER', 'LIST']);

const fieldSchema = z.object({
  key:      z.string().min(1).max(64),
  label:    z.string().min(1).max(255),
  type:     z.enum(['short_text', 'long_text', 'number', 'email', 'select', 'multiselect', 'checkbox', 'date']),
  required: z.boolean(),
  options:  z.array(z.string()).optional(),
  placeholder: z.string().optional(),
});
const branchingSchema = z.object({
  fieldKey: z.string().min(1),
  action:   z.enum(['show', 'hide']),
  when: z.object({
    fieldKey: z.string().min(1),
    op:       z.enum(['equals', 'not_equals', 'includes', 'is_empty', 'is_not_empty']),
    value:    z.string().optional(),
  }),
});
const configSchema = z.object({ fields: z.array(fieldSchema), branching: z.array(branchingSchema) });
const mappingSchema = z.record(z.object({ kind: z.enum(['task', 'custom_field']), target: z.string().min(1) }));

const createSchema = z.object({
  workspaceId:  z.string().uuid(),
  scopeType:    SCOPE,
  scopeId:      z.string().uuid(),
  name:         z.string().min(1).max(255),
  config:       configSchema,
  targetListId: z.string().uuid(),
  fieldMapping: mappingSchema,
  templateId:   z.string().uuid().nullable().optional(),
  isPublic:     z.boolean().optional(),
  publicSlug:   z.string().min(1).max(64).regex(/^[a-z0-9-]+$/).nullable().optional(),
  authRequired: z.boolean().optional(),
});
const updateSchema = z.object({
  name:         z.string().min(1).max(255).optional(),
  config:       configSchema.optional(),
  targetListId: z.string().uuid().optional(),
  fieldMapping: mappingSchema.optional(),
  templateId:   z.string().uuid().nullable().optional(),
  isPublic:     z.boolean().optional(),
  publicSlug:   z.string().min(1).max(64).regex(/^[a-z0-9-]+$/).nullable().optional(),
  authRequired: z.boolean().optional(),
});
const submitSchema = z.object({
  answers:   z.record(z.unknown()),
  readToken: z.string().min(1),
});

/** Inline object-level EDIT gate on a hierarchy node (mirrors templates route). */
async function gateObjectEdit(c: Context, type: 'SPACE' | 'FOLDER' | 'LIST', id: string, min: ObjectPermissionLevel = 'EDIT') {
  const userId = getUserId(c)!;
  const { level, found } = await accessService.resolveOrNull(userId, type, id);
  if (!found) return c.json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } }, 404);
  if (!level || LEVEL_ORDER[level] < LEVEL_ORDER[min])
    return c.json({ error: { code: 'FORBIDDEN', message: 'You do not have access' } }, 403);
  return null; // ok
}

// ───────────────────────────────────────────────────────────────────────────
// PUBLIC, UNAUTHENTICATED render + submit. These are the ONLY routes on this
// router that are NOT auth-gated (server.ts deliberately omits the blanket
// authMiddleware for /forms/*). DO NOT add an auth gate here.
// ───────────────────────────────────────────────────────────────────────────

// GET /forms/public/:slug — render a public form (no session).
formRoutes.get('/public/:slug', async (c) => {
  try {
    const view = await formService.renderPublic(c.req.param('slug'));
    return c.json({ data: view });
  } catch (err) {
    if (err instanceof FormNotFoundError || err instanceof FormNotPublicError)
      return c.json({ error: { code: (err as any).code, message: err.message } }, 404);
    throw err;
  }
});

// POST /forms/public/:slug/submit — anonymous OR authed submit.
// Optional auth: if a valid Bearer is present we attribute the submission to
// that user (and AuthRequired forms accept it); otherwise actorId is null.
formRoutes.post('/public/:slug/submit', zValidator('json', submitSchema), async (c) => {
  let actorId: string | null = null;
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as any;
      actorId = payload?.userId ?? null;
    } catch { actorId = null; } // invalid token → treated as anonymous
  }
  const { answers, readToken } = c.req.valid('json');
  try {
    const result = await formService.submit(c.req.param('slug'), answers, readToken, actorId);
    return c.json({ data: result }, 201);
  } catch (err) {
    if (err instanceof FormNotFoundError || err instanceof FormNotPublicError)
      return c.json({ error: { code: (err as any).code, message: err.message } }, 404);
    if (err instanceof FormAuthRequiredError)
      return c.json({ error: { code: err.code, message: err.message } }, 401);
    if (err instanceof FormValidationError)
      return c.json({ error: { code: err.code, message: err.message, details: err.detail } }, 422);
    throw err;
  }
});

// ───────────────────────────────────────────────────────────────────────────
// PROTECTED CRUD — every handler attaches authMiddleware inline + an ACL gate.
// ───────────────────────────────────────────────────────────────────────────

// POST /forms — EDIT on the form's scope node.
formRoutes.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const b = c.req.valid('json');
  if (!(await isWorkspaceMember(b.workspaceId, getUserId(c)!)))
    return c.json({ error: { code: 'FORBIDDEN', message: 'You do not have access' } }, 403);
  const denied = await gateObjectEdit(c, b.scopeType, b.scopeId);
  if (denied) return denied;
  const form = await formService.create(b, getUserId(c)!);
  return c.json({ data: form }, 201);
});

// GET /forms?workspaceId=&scopeType=&scopeId= — workspace-member gated.
const listQuery = z.object({
  workspaceId: z.string().uuid(),
  scopeType:   SCOPE.optional(),
  scopeId:     z.string().uuid().optional(),
});
formRoutes.get('/', authMiddleware, zValidator('query', listQuery), async (c) => {
  const { workspaceId, scopeType, scopeId } = c.req.valid('query');
  if (!(await isWorkspaceMember(workspaceId, getUserId(c)!)))
    return c.json({ error: { code: 'FORBIDDEN', message: 'You do not have access' } }, 403);
  const data = await formService.list(workspaceId, scopeType ?? null, scopeId ?? null);
  return c.json({ data });
});

// GET /forms/:id — VIEW on the form's scope node.
formRoutes.get('/:id', authMiddleware, async (c) => {
  const form = await formService.getById(c.req.param('id'));
  if (!form) return c.json({ error: { code: 'NOT_FOUND', message: 'Form not found' } }, 404);
  const denied = await gateObjectEdit(c, form.scopeType, form.scopeId, 'VIEW');
  if (denied) return denied;
  return c.json({ data: form });
});

// GET /forms/:id/submissions — VIEW on the form's scope node.
formRoutes.get('/:id/submissions', authMiddleware, async (c) => {
  const form = await formService.getById(c.req.param('id'));
  if (!form) return c.json({ error: { code: 'NOT_FOUND', message: 'Form not found' } }, 404);
  const denied = await gateObjectEdit(c, form.scopeType, form.scopeId, 'VIEW');
  if (denied) return denied;
  const data = await formService.listSubmissions(form.id);
  return c.json({ data });
});

// PUT /forms/:id — EDIT on the form's scope node.
formRoutes.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const form = await formService.getById(c.req.param('id'));
  if (!form) return c.json({ error: { code: 'NOT_FOUND', message: 'Form not found' } }, 404);
  const denied = await gateObjectEdit(c, form.scopeType, form.scopeId);
  if (denied) return denied;
  const updated = await formService.update(form.id, c.req.valid('json'));
  return c.json({ data: updated });
});

// DELETE /forms/:id — EDIT on the form's scope node.
formRoutes.delete('/:id', authMiddleware, async (c) => {
  const form = await formService.getById(c.req.param('id'));
  if (!form) return c.json({ error: { code: 'NOT_FOUND', message: 'Form not found' } }, 404);
  const denied = await gateObjectEdit(c, form.scopeType, form.scopeId);
  if (denied) return denied;
  const deleted = await formService.delete(form.id);
  return c.json({ data: deleted });
});
```

- [ ] Wire into `server.ts`. Add the import alongside the other route imports:

```ts
import { formRoutes } from './modules/forms/form.routes.js';
```

Mount it WITHOUT a blanket auth middleware — the public render/submit must stay open (mirrors the avatars + incoming-git-webhooks comment "no authMiddleware"). Add near the other `app.route(...)` calls, and add a clarifying comment by the auth-middleware block:

```ts
// Forms: the /forms/public/* render+submit pair is the ONLY unauthenticated
// surface (Phase 7c). DELIBERATELY no `app.use('/forms/*', authMiddleware)` —
// protected CRUD handlers attach authMiddleware inline (like avatars).
app.route('/forms', formRoutes);
```

- [ ] Run: `npm run build --workspace apps/api` (tsc). Expected: PASS. Then `npm test --workspace apps/api -- branching mapping`. Expected: still PASS.

- [ ] Commit:
```
git add apps/api/src/modules/forms/form.routes.ts apps/api/src/server.ts
git commit -m "feat(7c): form REST — protected CRUD (inline ACL) + UNauthenticated public render/submit pair"
```

---

### Task 7: Integration test (submit→task, template, auth-required)

**Files:**
- Create: `apps/api/src/modules/forms/__tests__/forms.integration.test.ts`

Steps:

- [ ] Write the failing integration test (copy the harness imports from `templates/__tests__/template-apply.integration.test.ts` or `recurrence.integration.test.ts`: `testServer.js`, `truncate.js`, `factories.js`). It seeds a Space → List + a LIST custom field, creates a PUBLIC form whose mapping targets `title` + that custom field, then renders (gets the read token) and submits anonymously, asserting a task was created in the target list with the mapped fields. A second case sets `authRequired` and asserts an anonymous submit is rejected. A third asserts a hidden-required field is NOT enforced:

```ts
/**
 * Phase 7c — Forms integration coverage.
 * Exercises the form SPs + REST surface (incl. the unauthenticated public
 * render/submit pair) against the REAL SQL stack.
 * DB SAFETY: must target local Docker ProjectFlow_Test (see e2e/README).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

async function seedListAndField() {
  const owner = await createTestUser({ email: `form-${Date.now()}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, { name: 'Form Space', key: `FM${Date.now() % 100000}` });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'Intake', position: 0 },
  }), 201)).data;
  const field = (await json<{ data: any }>(await request('/custom-fields', {
    method: 'POST', token, json: { scopeType: 'LIST', scopeId: list.id, type: 'number', name: 'Votes', required: false, position: 0 },
  }), 201)).data;
  return { owner, token, workspaceId: ws.Id, spaceId: space.Id, listId: list.id, fieldId: field.id };
}

function configBugIdea() {
  return {
    fields: [
      { key: 'summary', label: 'Summary', type: 'short_text', required: true },
      { key: 'kind',    label: 'Kind',    type: 'select',     required: true, options: ['bug', 'idea'] },
      { key: 'steps',   label: 'Steps',   type: 'long_text',  required: true },
      { key: 'votes',   label: 'Votes',   type: 'number',     required: false },
    ],
    branching: [
      { fieldKey: 'steps', action: 'show', when: { fieldKey: 'kind', op: 'equals', value: 'bug' } },
    ],
  };
}

describe('forms submit', () => {
  it('public submit creates a task in the target list with mapped fields + records a submission', async () => {
    const { token, workspaceId, spaceId, listId, fieldId } = await seedListAndField();
    const slug = `intake-${Date.now()}`;
    const form = (await json<{ data: any }>(await request('/forms', {
      method: 'POST', token,
      json: {
        workspaceId, scopeType: 'LIST', scopeId: listId, name: 'Public Intake',
        config: configBugIdea(),
        targetListId: listId,
        fieldMapping: {
          summary: { kind: 'task', target: 'title' },
          votes:   { kind: 'custom_field', target: fieldId },
        },
        isPublic: true, publicSlug: slug, authRequired: false,
      },
    }, ), 201)).data;
    expect(form.publicSlug).toBe(slug);

    // Render (no auth) → read token.
    const view = (await json<{ data: any }>(await request(`/forms/public/${slug}`, {}))).data;
    expect(view.readToken).toBeTruthy();

    // Anonymous submit (no token header) for an IDEA — "steps" is hidden so its
    // required-ness is not enforced.
    const submit = (await json<{ data: any }>(await request(`/forms/public/${slug}/submit`, {
      method: 'POST',
      json: { answers: { summary: 'Dark mode please', kind: 'idea', votes: 7 }, readToken: view.readToken },
    }), 201)).data;
    expect(submit.createdTaskId).toBeTruthy();

    // The task landed in the target list with the mapped title.
    const task = (await json<{ data: any }>(await request(`/tasks/${submit.createdTaskId}`, { token }))).data;
    expect(task.title ?? task.Title).toBe('Dark mode please');

    // The mapped custom-field value was set.
    const eff = (await json<{ data: any[] }>(await request(`/tasks/${submit.createdTaskId}/fields`, { token }))).data;
    expect(eff.find((e) => e.field?.name === 'Votes')?.value).toBe(7);
  });

  it('auth-required form rejects an anonymous submit (401)', async () => {
    const { token, workspaceId, listId } = await seedListAndField();
    const slug = `auth-${Date.now()}`;
    await request('/forms', {
      method: 'POST', token,
      json: {
        workspaceId, scopeType: 'LIST', scopeId: listId, name: 'Gated',
        config: { fields: [{ key: 'summary', label: 'S', type: 'short_text', required: true }], branching: [] },
        targetListId: listId, fieldMapping: { summary: { kind: 'task', target: 'title' } },
        isPublic: true, publicSlug: slug, authRequired: true,
      },
    }, );
    const view = (await json<{ data: any }>(await request(`/forms/public/${slug}`, {}))).data;
    const res  = await request(`/forms/public/${slug}/submit`, {
      method: 'POST', json: { answers: { summary: 'x' }, readToken: view.readToken },
    });
    expect(res.status).toBe(401);
  });

  it('rejects a submit missing a VISIBLE required field (422)', async () => {
    const { token, workspaceId, listId } = await seedListAndField();
    const slug = `req-${Date.now()}`;
    await request('/forms', {
      method: 'POST', token,
      json: {
        workspaceId, scopeType: 'LIST', scopeId: listId, name: 'Req',
        config: configBugIdea(), targetListId: listId,
        fieldMapping: { summary: { kind: 'task', target: 'title' } },
        isPublic: true, publicSlug: slug, authRequired: false,
      },
    }, );
    const view = (await json<{ data: any }>(await request(`/forms/public/${slug}`, {}))).data;
    // kind=bug makes "steps" visible + required, but it's missing → 422.
    const res = await request(`/forms/public/${slug}/submit`, {
      method: 'POST', json: { answers: { summary: 'crash', kind: 'bug' }, readToken: view.readToken },
    });
    expect(res.status).toBe(422);
  });
});
```

- [ ] Run: `npm run test:integration --workspace apps/api -- forms` against `ProjectFlow_Test`. Expected: PASS (3 tests). Then full unit: `npm test --workspace apps/api`. Expected: PASS.

- [ ] Commit:
```
git add apps/api/src/modules/forms/__tests__/forms.integration.test.ts
git commit -m "test(7c): forms integration — public submit→task+mapped fields, auth-required rejects anon, required-visible 422"
```

---

### Task 8: GraphQL mirror (`form.schema.ts`)

**Files:**
- Create: `apps/api/src/graphql/form.schema.ts`
- Modify: `apps/api/src/graphql/schema.ts` (import + call near the other `register*Graphql()` calls, ~line 768)

Steps:

- [ ] Write `form.schema.ts`, mirroring `templates.schema.ts`'s structure (`objectRef`, `notFound`/`requireObjectLevel`/`requireWorkspacePermission`/`requireAuth` from `./authz.js`, JSON columns transported as strings, delegating to the shared `formService`). The PUBLIC render/submit stay REST-only — the GraphQL mirror covers metadata CRUD + submissions only:

```ts
import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { formService } from '../modules/forms/form.service.js';
import { notFound, requireObjectLevel, requireWorkspacePermission, requireAuth } from './authz.js';
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
        const input: CreateFormInput = {
          workspaceId: a.workspaceId, scopeType: a.scopeType as Form['scopeType'], scopeId: a.scopeId,
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
```

- [ ] Wire into `schema.ts` — add the import alongside the others and call it near the other `register*Graphql()` calls:

```ts
import { registerFormsGraphql } from './form.schema.js';
```
```ts
// ─────────────────────────────────────────
// Forms (Phase 7c) — Form/FormSubmission types + forms/form/formSubmissions
// queries + create/update/deleteForm mutations. Public render/submit stay REST.
// ─────────────────────────────────────────
registerFormsGraphql();
```

- [ ] Run: `npm run build --workspace apps/api` (tsc — compiles the Pothos schema). Expected: PASS. Then `npm test --workspace apps/api`. Expected: PASS (existing GraphQL authz tests still green).

- [ ] Commit:
```
git add apps/api/src/graphql/form.schema.ts apps/api/src/graphql/schema.ts
git commit -m "feat(7c): GraphQL forms mirror — forms/form/formSubmissions + create/update/deleteForm (public stays REST)"
```

---

### Task 9: Frontend — server actions + public fetch helpers + client branching evaluator

**Files:**
- Create: `apps/next-web/src/server/actions/forms.ts`
- Create: `apps/next-web/src/server/public/forms.ts`
- Create: `apps/next-web/src/lib/formBranching.ts`
- Create: `apps/next-web/src/lib/__tests__/formBranching.unit.test.ts`
- Note: read `node_modules/next/dist/docs/` (repo-root, Next 16.2.7) per `apps/next-web/AGENTS.md` BEFORE writing web code.

Steps:

- [ ] Read the relevant Next docs first: `node_modules/next/dist/docs/01-app/01-getting-started/` (routing, route groups, server actions) — the public form route must sit OUTSIDE the `(app)` group, and server actions must keep `'use server'`.

- [ ] Write `apps/next-web/src/server/actions/forms.ts` — authed CRUD over `serverFetch` (mirrors `templates.ts`):

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { getWorkspaceProjectContext } from '../context';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';
import type { Form, FormSubmission, CreateFormInput, UpdateFormInput } from '@projectflow/types';

export async function createForm(input: CreateFormInput): Promise<ActionResult<Form>> {
  await requireSession();
  let data: Form;
  try {
    data = await serverFetch<Form>('/forms', { method: 'POST', body: JSON.stringify(input) });
  } catch (e) { return toActionError(e); }
  revalidatePath('/forms');
  return { ok: true, data };
}

export async function updateForm(id: string, patch: UpdateFormInput): Promise<ActionResult<Form>> {
  await requireSession();
  let data: Form;
  try {
    data = await serverFetch<Form>(`/forms/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(patch) });
  } catch (e) { return toActionError(e); }
  revalidatePath('/forms');
  revalidatePath(`/forms/${id}`);
  return { ok: true, data };
}

export async function deleteForm(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/forms/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) { return toActionError(e); }
  revalidatePath('/forms');
  return { ok: true };
}

export async function listForms(): Promise<Form[]> {
  await requireSession();
  const { activeWorkspaceId } = await getWorkspaceProjectContext();
  if (!activeWorkspaceId) return [];
  try {
    const params = new URLSearchParams({ workspaceId: activeWorkspaceId });
    return (await serverFetch<Form[]>(`/forms?${params.toString()}`)) ?? [];
  } catch { return []; }
}

export async function getForm(id: string): Promise<Form | null> {
  await requireSession();
  try {
    return (await serverFetch<Form>(`/forms/${encodeURIComponent(id)}`)) ?? null;
  } catch { return null; }
}

export async function listSubmissions(formId: string): Promise<FormSubmission[]> {
  await requireSession();
  try {
    return (await serverFetch<FormSubmission[]>(`/forms/${encodeURIComponent(formId)}/submissions`)) ?? [];
  } catch { return []; }
}
```

- [ ] Write `apps/next-web/src/server/public/forms.ts` — UNauthenticated fetch (the public render/submit must NOT use `serverFetch`, which redirects to `/login` on 401). Talk to the API base directly:

```ts
import 'server-only';
import type { PublicFormView, SubmitFormResult } from '@projectflow/types';

const API_BASE =
  process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/** Public, sessionless render of a form by slug. Returns null when not found. */
export async function fetchPublicForm(slug: string): Promise<PublicFormView | null> {
  const res = await fetch(`${API_BASE}/api/v1/forms/public/${encodeURIComponent(slug)}`, { cache: 'no-store' });
  if (!res.ok) return null;
  const body = await res.json().catch(() => ({}));
  return (body?.data as PublicFormView) ?? null;
}

/** Public, sessionless submit. Returns the result or throws a plain Error with the API message. */
export async function submitPublicForm(
  slug: string,
  answers: Record<string, unknown>,
  readToken: string,
): Promise<SubmitFormResult> {
  const res = await fetch(`${API_BASE}/api/v1/forms/public/${encodeURIComponent(slug)}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers, readToken }),
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? `Submit failed (${res.status})`);
  return body.data as SubmitFormResult;
}
```

- [ ] Write `apps/next-web/src/lib/formBranching.ts` — a CLIENT-safe copy of the pure evaluator (no `server-only` import, identical logic to `apps/api/src/modules/forms/form.branching.ts` so the renderer hides/shows exactly as the server validates):

```ts
import type { FormConfig, FormBranchingRule } from '@projectflow/types';

type Answers = Record<string, unknown>;

function asString(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(String).join(',');
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}
function isEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'string') return v.trim() === '';
  return false;
}
function conditionHolds(rule: FormBranchingRule, answers: Answers): boolean {
  const actual = answers[rule.when.fieldKey];
  switch (rule.when.op) {
    case 'equals':       return asString(actual) === asString(rule.when.value ?? '');
    case 'not_equals':   return asString(actual) !== asString(rule.when.value ?? '');
    case 'includes':     return Array.isArray(actual)
      ? actual.map(String).includes(String(rule.when.value ?? ''))
      : asString(actual).includes(String(rule.when.value ?? ''));
    case 'is_empty':     return isEmpty(actual);
    case 'is_not_empty': return !isEmpty(actual);
    default:             return false;
  }
}

export function evalVisibility(config: FormConfig, answers: Answers): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const field of config.fields) {
    const rules = config.branching.filter((r) => r.fieldKey === field.key);
    if (rules.length === 0) { out[field.key] = true; continue; }
    let visible = !rules.some((r) => r.action === 'show');
    for (const rule of rules) {
      if (conditionHolds(rule, answers)) visible = rule.action === 'show';
    }
    out[field.key] = visible;
  }
  return out;
}

export interface ClientValidation { ok: boolean; missing: string[] }
export function validateAnswers(config: FormConfig, answers: Answers): ClientValidation {
  const visibility = evalVisibility(config, answers);
  const missing: string[] = [];
  for (const field of config.fields) {
    if (!visibility[field.key]) continue;
    if (field.required && isEmpty(answers[field.key])) missing.push(field.key);
  }
  return { ok: missing.length === 0, missing };
}
```

- [ ] Write `apps/next-web/src/lib/__tests__/formBranching.unit.test.ts` (mirrors the API branching test, proves the client evaluator matches):

```ts
import { describe, it, expect } from 'vitest';
import { evalVisibility, validateAnswers } from '../formBranching';
import type { FormConfig } from '@projectflow/types';

const config: FormConfig = {
  fields: [
    { key: 'kind',  label: 'Kind',  type: 'select',    required: true,  options: ['bug', 'idea'] },
    { key: 'steps', label: 'Steps', type: 'long_text', required: true },
  ],
  branching: [
    { fieldKey: 'steps', action: 'show', when: { fieldKey: 'kind', op: 'equals', value: 'bug' } },
  ],
};

describe('client formBranching', () => {
  it('shows steps for a bug and hides it for an idea', () => {
    expect(evalVisibility(config, { kind: 'bug' }).steps).toBe(true);
    expect(evalVisibility(config, { kind: 'idea' }).steps).toBe(false);
  });
  it('does not enforce a hidden required field', () => {
    expect(validateAnswers(config, { kind: 'idea' }).ok).toBe(true);
  });
  it('enforces a visible required field', () => {
    const r = validateAnswers(config, { kind: 'bug' });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('steps');
  });
});
```

- [ ] Run: `npm test --workspace apps/next-web -- formBranching`. Expected: PASS (3 tests).

- [ ] Commit:
```
git add apps/next-web/src/server/actions/forms.ts apps/next-web/src/server/public/forms.ts apps/next-web/src/lib/formBranching.ts apps/next-web/src/lib/__tests__/formBranching.unit.test.ts
git commit -m "feat(7c): web forms server actions + sessionless public fetch + client branching evaluator + unit test"
```

---

### Task 10: Frontend — Form Builder component + authed pages + i18n

**Files:**
- Create: `apps/next-web/src/components/forms/FormBuilder.tsx`
- Create: `apps/next-web/src/components/forms/FormBuilder.module.css`
- Create: `apps/next-web/src/app/(app)/forms/page.tsx`
- Create: `apps/next-web/src/app/(app)/forms/[id]/page.tsx`
- Modify: `apps/next-web/src/messages/en.json`
- Modify: `apps/next-web/src/messages/id.json`

Steps:

- [ ] Read the Next docs for the App Router + Server Components page conventions (`node_modules/next/dist/docs/01-app/01-getting-started/`) before writing the pages.

- [ ] Write `apps/next-web/src/components/forms/FormBuilder.tsx` — a client component that holds the form definition in state, lets the user add/reorder fields from a drag palette, edit per-field config, add branching rules over PRIOR fields, pick the target list + per-field mapping + optional template, and save via `createForm`/`updateForm`. Branching-rule editor only offers EARLIER fields as conditions:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { createForm, updateForm } from '@/server/actions/forms';
import { notifyActionError } from '@/lib/apiErrorToast';
import styles from './FormBuilder.module.css';
import type {
  Form, FormConfig, FormField, FormFieldType, FormBranchingRule, FormFieldMapping,
} from '@projectflow/types';

const FIELD_TYPES: FormFieldType[] = ['short_text', 'long_text', 'number', 'email', 'select', 'multiselect', 'checkbox', 'date'];

interface ListOption { id: string; name: string }
interface TemplateOption { id: string; name: string }

interface Props {
  workspaceId: string;
  scopeType: 'SPACE' | 'FOLDER' | 'LIST';
  scopeId: string;
  lists: ListOption[];
  templates: TemplateOption[];
  initial?: Form;            // present in edit mode
}

function uniqueKey(existing: FormField[], base: string): string {
  let k = base; let i = 1;
  while (existing.some((f) => f.key === k)) k = `${base}_${i++}`;
  return k;
}

export function FormBuilder({ workspaceId, scopeType, scopeId, lists, templates, initial }: Props) {
  const t = useTranslations('Forms');
  const [name, setName] = useState(initial?.name ?? '');
  const [fields, setFields] = useState<FormField[]>(initial?.config.fields ?? []);
  const [branching, setBranching] = useState<FormBranchingRule[]>(initial?.config.branching ?? []);
  const [targetListId, setTargetListId] = useState(initial?.targetListId ?? lists[0]?.id ?? '');
  const [mapping, setMapping] = useState<FormFieldMapping>(initial?.fieldMapping ?? {});
  const [templateId, setTemplateId] = useState<string | null>(initial?.templateId ?? null);
  const [isPublic, setIsPublic] = useState(initial?.isPublic ?? false);
  const [publicSlug, setPublicSlug] = useState(initial?.publicSlug ?? '');
  const [authRequired, setAuthRequired] = useState(initial?.authRequired ?? false);
  const [pending, start] = useTransition();

  const addField = (type: FormFieldType) =>
    setFields((prev) => [...prev, {
      key: uniqueKey(prev, type), label: t('newFieldLabel'), type, required: false,
      ...(type === 'select' || type === 'multiselect' ? { options: ['Option 1'] } : {}),
    }]);

  const patchField = (idx: number, patch: Partial<FormField>) =>
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  const removeField = (idx: number) => {
    const key = fields[idx].key;
    setFields((prev) => prev.filter((_, i) => i !== idx));
    setBranching((prev) => prev.filter((r) => r.fieldKey !== key && r.when.fieldKey !== key));
    setMapping((prev) => { const next = { ...prev }; delete next[key]; return next; });
  };
  const move = (idx: number, dir: -1 | 1) => setFields((prev) => {
    const next = [...prev]; const j = idx + dir;
    if (j < 0 || j >= next.length) return prev;
    [next[idx], next[j]] = [next[j], next[idx]]; return next;
  });

  const addRule = () => {
    if (fields.length < 2) return;
    setBranching((prev) => [...prev, {
      fieldKey: fields[fields.length - 1].key, action: 'show',
      when: { fieldKey: fields[0].key, op: 'equals', value: '' },
    }]);
  };
  const patchRule = (idx: number, patch: Partial<FormBranchingRule>) =>
    setBranching((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const removeRule = (idx: number) => setBranching((prev) => prev.filter((_, i) => i !== idx));

  const setMap = (key: string, kind: 'task' | 'custom_field', target: string) =>
    setMapping((prev) => ({ ...prev, [key]: { kind, target } }));

  const onSave = () => start(async () => {
    const config: FormConfig = { fields, branching };
    const input = {
      workspaceId, scopeType, scopeId, name, config, targetListId, fieldMapping: mapping,
      templateId, isPublic, publicSlug: isPublic ? publicSlug : null, authRequired,
    };
    const r = initial
      ? await updateForm(initial.id, input)
      : await createForm(input);
    if (!r.ok) return notifyActionError(r);
  });

  // Earlier-than-idx field keys can be a branching CONDITION for a later field.
  const earlierKeys = (key: string) => {
    const idx = fields.findIndex((f) => f.key === key);
    return fields.slice(0, idx < 0 ? fields.length : idx).map((f) => f.key);
  };

  return (
    <div className={styles.root}>
      <input className={styles.nameInput} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('formName')} />

      <section className={styles.section}>
        <h3>{t('fields')}</h3>
        <div className={styles.palette}>
          {FIELD_TYPES.map((ft) => (
            <button key={ft} className={styles.paletteBtn} onClick={() => addField(ft)}>{t(`type.${ft}`)}</button>
          ))}
        </div>
        <ul className={styles.fieldList}>
          {fields.map((f, idx) => (
            <li key={f.key} className={styles.fieldRow} data-field-key={f.key}>
              <input className={styles.fieldLabel} value={f.label} onChange={(e) => patchField(idx, { label: e.target.value })} />
              <span className={styles.fieldType}>{t(`type.${f.type}`)}</span>
              {(f.type === 'select' || f.type === 'multiselect') && (
                <input
                  className={styles.optionsInput}
                  value={(f.options ?? []).join(', ')}
                  onChange={(e) => patchField(idx, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                  placeholder={t('optionsCsv')}
                />
              )}
              <label className={styles.requiredToggle}>
                <input type="checkbox" checked={f.required} onChange={(e) => patchField(idx, { required: e.target.checked })} />
                {t('required')}
              </label>
              <span className={styles.fieldActions}>
                <button onClick={() => move(idx, -1)} aria-label={t('moveUp')}>↑</button>
                <button onClick={() => move(idx, 1)} aria-label={t('moveDown')}>↓</button>
                <button onClick={() => removeField(idx)} aria-label={t('removeField')}>✕</button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h3>{t('branching')}</h3>
        <button className={styles.addBtn} onClick={addRule} disabled={fields.length < 2}>{t('addRule')}</button>
        <ul className={styles.ruleList}>
          {branching.map((r, idx) => (
            <li key={idx} className={styles.ruleRow}>
              <select value={r.action} onChange={(e) => patchRule(idx, { action: e.target.value as 'show' | 'hide' })}>
                <option value="show">{t('actionShow')}</option>
                <option value="hide">{t('actionHide')}</option>
              </select>
              <select value={r.fieldKey} onChange={(e) => patchRule(idx, { fieldKey: e.target.value })}>
                {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <span>{t('when')}</span>
              <select value={r.when.fieldKey} onChange={(e) => patchRule(idx, { when: { ...r.when, fieldKey: e.target.value } })}>
                {earlierKeys(r.fieldKey).map((k) => {
                  const fld = fields.find((f) => f.key === k)!;
                  return <option key={k} value={k}>{fld.label}</option>;
                })}
              </select>
              <select value={r.when.op} onChange={(e) => patchRule(idx, { when: { ...r.when, op: e.target.value as FormBranchingRule['when']['op'] } })}>
                <option value="equals">=</option>
                <option value="not_equals">≠</option>
                <option value="includes">⊇</option>
                <option value="is_empty">{t('opEmpty')}</option>
                <option value="is_not_empty">{t('opNotEmpty')}</option>
              </select>
              {(r.when.op === 'equals' || r.when.op === 'not_equals' || r.when.op === 'includes') && (
                <input value={r.when.value ?? ''} onChange={(e) => patchRule(idx, { when: { ...r.when, value: e.target.value } })} placeholder={t('value')} />
              )}
              <button onClick={() => removeRule(idx)} aria-label={t('removeRule')}>✕</button>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h3>{t('mapping')}</h3>
        <label className={styles.targetRow}>
          {t('targetList')}
          <select value={targetListId} onChange={(e) => setTargetListId(e.target.value)}>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <ul className={styles.mapList}>
          {fields.map((f) => {
            const m = mapping[f.key];
            return (
              <li key={f.key} className={styles.mapRow}>
                <span className={styles.mapLabel}>{f.label}</span>
                <select
                  value={m ? `${m.kind}:${m.target}` : ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) { setMapping((p) => { const n = { ...p }; delete n[f.key]; return n; }); return; }
                    const [kind, target] = v.split(':') as ['task' | 'custom_field', string];
                    setMap(f.key, kind, target);
                  }}
                >
                  <option value="">{t('mapNone')}</option>
                  <option value="task:title">{t('mapTitle')}</option>
                  <option value="task:description">{t('mapDescription')}</option>
                  <option value="task:priority">{t('mapPriority')}</option>
                </select>
              </li>
            );
          })}
        </ul>
        <label className={styles.targetRow}>
          {t('applyTemplate')}
          <select value={templateId ?? ''} onChange={(e) => setTemplateId(e.target.value || null)}>
            <option value="">{t('noTemplate')}</option>
            {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
          </select>
        </label>
      </section>

      <section className={styles.section}>
        <h3>{t('publishing')}</h3>
        <label><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /> {t('makePublic')}</label>
        {isPublic && (
          <input className={styles.slugInput} value={publicSlug} onChange={(e) => setPublicSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder={t('slug')} />
        )}
        <label><input type="checkbox" checked={authRequired} onChange={(e) => setAuthRequired(e.target.checked)} /> {t('authRequired')}</label>
      </section>

      <button className={styles.saveBtn} onClick={onSave} disabled={pending || !name || fields.length === 0 || !targetListId}>
        {pending ? t('saving') : t('save')}
      </button>
    </div>
  );
}
```

- [ ] Write `apps/next-web/src/components/forms/FormBuilder.module.css`:

```css
.root { display: flex; flex-direction: column; gap: 20px; max-width: 880px; }
.nameInput { font-size: 20px; font-weight: 600; padding: 6px 10px; border: 1px solid var(--border, #d1d5db); border-radius: 8px; }
.section { border: 1px solid var(--border, #e5e7eb); border-radius: 10px; padding: 14px; }
.section h3 { margin: 0 0 10px; font-size: 14px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-2, #6b7280); }
.palette { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.paletteBtn, .addBtn { border: 1px dashed var(--border, #cbd5e1); background: transparent; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.fieldList, .ruleList, .mapList { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.fieldRow, .ruleRow, .mapRow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fieldLabel { flex: 1; min-width: 140px; padding: 4px 8px; }
.fieldType { font-size: 12px; color: var(--text-2, #6b7280); }
.optionsInput, .slugInput { flex: 1; min-width: 160px; padding: 4px 8px; }
.requiredToggle { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; }
.fieldActions button, .ruleRow button, .mapRow button { border: none; background: transparent; cursor: pointer; }
.targetRow { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
.mapLabel { min-width: 160px; }
.saveBtn { align-self: flex-start; background: #2563eb; color: #fff; border: none; border-radius: 8px; padding: 8px 20px; cursor: pointer; }
.saveBtn:disabled { opacity: .6; cursor: default; }
```

- [ ] Write `apps/next-web/src/app/(app)/forms/page.tsx` — the authed list (Server Component; loads forms for the active workspace and links to each builder):

```tsx
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { listForms } from '@/server/actions/forms';

export default async function FormsPage() {
  const t = await getTranslations('Forms');
  const forms = await listForms();
  return (
    <main style={{ padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1>{t('title')}</h1>
        <Link href="/forms/new">{t('newForm')}</Link>
      </header>
      <ul>
        {forms.map((f) => (
          <li key={f.id}>
            <Link href={`/forms/${f.id}`}>{f.name}</Link>
            {f.isPublic && f.publicSlug && (
              <span> · <Link href={`/forms/${f.publicSlug}`} target="_blank">{t('openPublic')}</Link></span>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] Write `apps/next-web/src/app/(app)/forms/[id]/page.tsx` — the builder page. For `new` it renders an empty builder; for an existing id it loads the form. It also loads the workspace's lists + templates to populate the pickers (reuse the existing hierarchy + templates loaders). Note: in Next 16 `params` is async — read the docs and `await params`:

```tsx
import { notFound } from 'next/navigation';
import { getForm } from '@/server/actions/forms';
import { listTemplates } from '@/server/actions/templates';
import { getWorkspaceProjectContext } from '@/server/context';
import { loadListsForWorkspace } from '@/server/queries/hierarchy'; // existing list loader (adapt to the real export)
import { FormBuilder } from '@/components/forms/FormBuilder';

export default async function FormBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { activeWorkspaceId } = await getWorkspaceProjectContext();
  if (!activeWorkspaceId) notFound();

  const [lists, templates] = await Promise.all([
    loadListsForWorkspace(activeWorkspaceId),  // -> { id, name }[]
    listTemplates('LIST'),                      // -> Template[]
  ]);
  const templateOptions = templates.map((tpl) => ({ id: tpl.id, name: tpl.name }));

  if (id === 'new') {
    const scopeId = lists[0]?.id ?? activeWorkspaceId;
    return (
      <main style={{ padding: 24 }}>
        <FormBuilder
          workspaceId={activeWorkspaceId}
          scopeType="LIST"
          scopeId={scopeId}
          lists={lists}
          templates={templateOptions}
        />
      </main>
    );
  }

  const form = await getForm(id);
  if (!form) notFound();
  return (
    <main style={{ padding: 24 }}>
      <FormBuilder
        workspaceId={form.workspaceId}
        scopeType={form.scopeType}
        scopeId={form.scopeId}
        lists={lists}
        templates={templateOptions}
        initial={form}
      />
    </main>
  );
}
```

(If `loadListsForWorkspace`/`getWorkspaceProjectContext` exact names differ, adapt to the real exports in `apps/next-web/src/server/`; the load-bearing shape is `{ id, name }[]` for lists.)

- [ ] Add the `Forms` namespace to `en.json` (merge as a new top-level block):

```json
"Forms": {
  "title": "Forms",
  "newForm": "New form",
  "openPublic": "Open public link",
  "formName": "Form name",
  "newFieldLabel": "Untitled field",
  "fields": "Fields",
  "required": "Required",
  "optionsCsv": "Options (comma-separated)",
  "moveUp": "Move up",
  "moveDown": "Move down",
  "removeField": "Remove field",
  "branching": "Conditional logic",
  "addRule": "Add rule",
  "actionShow": "Show",
  "actionHide": "Hide",
  "when": "when",
  "opEmpty": "is empty",
  "opNotEmpty": "is not empty",
  "value": "value",
  "removeRule": "Remove rule",
  "mapping": "Field mapping",
  "targetList": "Target list",
  "mapNone": "Not mapped",
  "mapTitle": "Task title",
  "mapDescription": "Task description",
  "mapPriority": "Task priority",
  "applyTemplate": "Apply template on submit",
  "noTemplate": "No template",
  "publishing": "Publishing",
  "makePublic": "Make public",
  "slug": "public-link-slug",
  "authRequired": "Require sign-in to submit",
  "saving": "Saving…",
  "save": "Save form",
  "submit": "Submit",
  "submitting": "Submitting…",
  "thanks": "Thanks — your submission was received.",
  "submitError": "Submission failed. Please check the form and try again.",
  "notFound": "This form is not available.",
  "type": {
    "short_text": "Short text",
    "long_text": "Long text",
    "number": "Number",
    "email": "Email",
    "select": "Dropdown",
    "multiselect": "Multi-select",
    "checkbox": "Checkbox",
    "date": "Date"
  }
}
```

- [ ] Add the same keys to `id.json` with real Indonesian:

```json
"Forms": {
  "title": "Formulir",
  "newForm": "Formulir baru",
  "openPublic": "Buka tautan publik",
  "formName": "Nama formulir",
  "newFieldLabel": "Bidang tanpa judul",
  "fields": "Bidang",
  "required": "Wajib",
  "optionsCsv": "Opsi (pisahkan dengan koma)",
  "moveUp": "Naik",
  "moveDown": "Turun",
  "removeField": "Hapus bidang",
  "branching": "Logika kondisional",
  "addRule": "Tambah aturan",
  "actionShow": "Tampilkan",
  "actionHide": "Sembunyikan",
  "when": "ketika",
  "opEmpty": "kosong",
  "opNotEmpty": "tidak kosong",
  "value": "nilai",
  "removeRule": "Hapus aturan",
  "mapping": "Pemetaan bidang",
  "targetList": "Daftar tujuan",
  "mapNone": "Tidak dipetakan",
  "mapTitle": "Judul tugas",
  "mapDescription": "Deskripsi tugas",
  "mapPriority": "Prioritas tugas",
  "applyTemplate": "Terapkan templat saat kirim",
  "noTemplate": "Tanpa templat",
  "publishing": "Publikasi",
  "makePublic": "Jadikan publik",
  "slug": "slug-tautan-publik",
  "authRequired": "Wajib masuk untuk mengirim",
  "saving": "Menyimpan…",
  "save": "Simpan formulir",
  "submit": "Kirim",
  "submitting": "Mengirim…",
  "thanks": "Terima kasih — kiriman Anda telah diterima.",
  "submitError": "Pengiriman gagal. Periksa formulir lalu coba lagi.",
  "notFound": "Formulir ini tidak tersedia.",
  "type": {
    "short_text": "Teks pendek",
    "long_text": "Teks panjang",
    "number": "Angka",
    "email": "Email",
    "select": "Tarik-turun",
    "multiselect": "Pilihan ganda",
    "checkbox": "Kotak centang",
    "date": "Tanggal"
  }
}
```

- [ ] Run: `npm test --workspace apps/next-web` (includes the `messages.unit` i18n parity test). Expected: PASS — en/id key parity green. Then `npm run build --workspace apps/next-web`. Expected: PASS (the `(app)/forms` pages compile).

- [ ] Commit:
```
git add apps/next-web/src/components/forms/FormBuilder.tsx apps/next-web/src/components/forms/FormBuilder.module.css "apps/next-web/src/app/(app)/forms/page.tsx" "apps/next-web/src/app/(app)/forms/[id]/page.tsx" apps/next-web/src/messages/en.json apps/next-web/src/messages/id.json
git commit -m "feat(7c): form builder (fields/branching/mapping/template/publish) + authed pages + Forms i18n (en+id)"
```

---

### Task 11: Frontend — public renderer + public route OUTSIDE `(app)`

**Files:**
- Create: `apps/next-web/src/components/forms/PublicFormRenderer.tsx`
- Create: `apps/next-web/src/components/forms/PublicFormRenderer.module.css`
- Create: `apps/next-web/src/app/forms/[slug]/page.tsx`  ← **OUTSIDE `(app)`**
- Create: `apps/next-web/src/server/actions/public-forms.ts`  (a `'use server'` submit wrapper the renderer calls)
- Note: this route MUST live at `app/forms/[slug]/` (NOT under `app/(app)/`) so it renders without a session. Per `apps/next-web/AGENTS.md`, read the Next docs on route groups first.

Steps:

- [ ] Read `node_modules/next/dist/docs/01-app/01-getting-started/` route-groups + server-actions notes. Confirm: a route placed at `app/forms/[slug]/` is NOT inside the `(app)` group, so it does NOT inherit the authenticated layout.

- [ ] Write `apps/next-web/src/server/actions/public-forms.ts` — a thin `'use server'` action so the client renderer can post the submission without bundling the API base into the client:

```ts
'use server';

import { submitPublicForm } from '../public/forms';
import type { SubmitFormResult } from '@projectflow/types';

export async function submitPublicFormAction(
  slug: string,
  answers: Record<string, unknown>,
  readToken: string,
): Promise<{ ok: true; data: SubmitFormResult } | { ok: false; error: string }> {
  try {
    const data = await submitPublicForm(slug, answers, readToken);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Submit failed' };
  }
}
```

- [ ] Write `apps/next-web/src/components/forms/PublicFormRenderer.tsx` — a client component that renders only the fields `evalVisibility` marks visible (recomputed on every answer change), validates client-side via `validateAnswers`, and posts via the server action. On success it shows a thank-you state:

```tsx
'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { evalVisibility, validateAnswers } from '@/lib/formBranching';
import { submitPublicFormAction } from '@/server/actions/public-forms';
import styles from './PublicFormRenderer.module.css';
import type { PublicFormView, FormField } from '@projectflow/types';

export function PublicFormRenderer({ slug, view }: { slug: string; view: PublicFormView }) {
  const t = useTranslations('Forms');
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const visibility = useMemo(() => evalVisibility(view.config, answers), [view.config, answers]);
  const visibleFields = view.config.fields.filter((f) => visibility[f.key]);

  const setAnswer = (key: string, value: unknown) => setAnswers((prev) => ({ ...prev, [key]: value }));

  const onSubmit = () => {
    const v = validateAnswers(view.config, answers);
    if (!v.ok) { setError(t('submitError')); return; }
    // Send only visible answers (hidden ones are stripped server-side too).
    const payload: Record<string, unknown> = {};
    for (const f of visibleFields) if (answers[f.key] != null) payload[f.key] = answers[f.key];
    start(async () => {
      const r = await submitPublicFormAction(slug, payload, view.readToken);
      if (!r.ok) { setError(r.error || t('submitError')); return; }
      setError(null); setDone(true);
    });
  };

  if (done) return <div className={styles.thanks}>{t('thanks')}</div>;

  return (
    <form className={styles.root} onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <h1 className={styles.title}>{view.name}</h1>
      {visibleFields.map((f) => (
        <div key={f.key} className={styles.field} data-field-key={f.key}>
          <label className={styles.label}>
            {f.label}{f.required && <span className={styles.req}> *</span>}
          </label>
          {renderInput(f, answers[f.key], (v) => setAnswer(f.key, v))}
        </div>
      ))}
      {error && <p className={styles.error}>{error}</p>}
      <button className={styles.submitBtn} type="submit" disabled={pending}>
        {pending ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}

function renderInput(field: FormField, value: unknown, onChange: (v: unknown) => void) {
  switch (field.type) {
    case 'long_text':
      return <textarea value={(value as string) ?? ''} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <input type="number" value={(value as number) ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />;
    case 'email':
      return <input type="email" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'date':
      return <input type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'checkbox':
      return <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
    case 'select':
      return (
        <select value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case 'multiselect':
      return (
        <select
          multiple
          value={(value as string[]) ?? []}
          onChange={(e) => onChange(Array.from(e.target.selectedOptions).map((o) => o.value))}
        >
          {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    default: // short_text
      return <input type="text" value={(value as string) ?? ''} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
}
```

- [ ] Write `apps/next-web/src/components/forms/PublicFormRenderer.module.css`:

```css
.root { max-width: 560px; margin: 48px auto; display: flex; flex-direction: column; gap: 16px; padding: 24px; }
.title { margin: 0 0 8px; font-size: 24px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.label { font-weight: 600; }
.req { color: #ef4444; }
.field input[type="text"], .field input[type="email"], .field input[type="number"], .field input[type="date"], .field textarea, .field select {
  padding: 8px 10px; border: 1px solid var(--border, #d1d5db); border-radius: 8px; font: inherit;
}
.field textarea { min-height: 96px; resize: vertical; }
.error { color: #ef4444; }
.submitBtn { align-self: flex-start; background: #2563eb; color: #fff; border: none; border-radius: 8px; padding: 10px 24px; cursor: pointer; }
.submitBtn:disabled { opacity: .6; cursor: default; }
.thanks { max-width: 560px; margin: 96px auto; text-align: center; font-size: 18px; }
```

- [ ] Write `apps/next-web/src/app/forms/[slug]/page.tsx` — **OUTSIDE `(app)`**, sessionless SSR fetch of the public form, then mount the renderer. `notFound()` when the slug doesn't resolve:

```tsx
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { fetchPublicForm } from '@/server/public/forms';
import { PublicFormRenderer } from '@/components/forms/PublicFormRenderer';

export default async function PublicFormPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await fetchPublicForm(slug);
  if (!view) notFound();
  return <PublicFormRenderer slug={slug} view={view} />;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await fetchPublicForm(slug);
  const t = await getTranslations('Forms');
  return { title: view?.name ?? t('notFound') };
}
```

- [ ] Run: `npm run build --workspace apps/next-web`. Expected: PASS — the public `app/forms/[slug]/page.tsx` builds OUTSIDE the `(app)` layout (no session dependency); the `(app)/forms` pages still build. Then `npm test --workspace apps/next-web -- formBranching`. Expected: still PASS.

- [ ] Commit:
```
git add apps/next-web/src/components/forms/PublicFormRenderer.tsx apps/next-web/src/components/forms/PublicFormRenderer.module.css "apps/next-web/src/app/forms/[slug]/page.tsx" apps/next-web/src/server/actions/public-forms.ts
git commit -m "feat(7c): public form renderer (client branching) + sessionless render route OUTSIDE (app)"
```

---

### Task 12: Playwright e2e (headline acceptance §6.5)

**Files:**
- Create: `e2e/forms.spec.ts`  (repo-root `e2e/`, alongside `templates.spec.ts`)
- Note: e2e runs against local Docker `ProjectFlow_Test` only (the same env/global-setup the views/templates specs use).

Steps:

- [ ] Write the e2e spec covering BUILD_PLAN acceptance §6.5 — a form with conditional logic hides/shows questions and creates a task on submit. Seed (over REST) a workspace → Space → List, create a PUBLIC form whose config branches (a "steps" field only shows when kind=bug) and maps `summary→title`, then drive the BROWSER through the public renderer: pick "idea" (steps hidden), pick "bug" (steps appears), fill + submit, and assert via the authed REST API that a task was created in the target list. Follow the `templates.spec.ts` harness (API register/login, then `browser.newContext()` for the UI step):

```ts
/**
 * E2E: Forms (Phase 7c). Proves BUILD_PLAN acceptance §6.5 end-to-end:
 *   "a form with conditional logic hides/shows questions and creates a task on submit."
 *
 * One authed user seeds (REST) a Space → List and a PUBLIC form whose config
 * branches: "steps" is shown only when kind=bug; "summary" maps to the task
 * title. A fresh (UNauthenticated) browser context opens the public renderer at
 * /forms/:slug, verifies the branching toggles "steps" by selecting idea vs bug,
 * fills + submits, and the authed API confirms a task landed in the target list
 * with the mapped title.
 *
 * DB SAFETY: run ONLY with the local Docker test DB env (see e2e/README.md).
 */
import { test, expect, request as playwrightRequest } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';

function uniq(): string { return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`; }

test('forms: conditional logic hides/shows questions and submit creates a task', async ({ browser }) => {
  const suffix   = uniq();
  const password = 'E2EPass123!';
  const email    = `form-${suffix}@projectflow.test`;
  const slug     = `intake-${suffix}`;
  const summary  = `Dark mode ${suffix}`;

  const api = await playwrightRequest.newContext();

  // ── Register + login (API) ──────────────────────────────────────────────────
  expect((await api.post(`${API_BASE}/auth/register`, { data: { email, name: `Form ${suffix}`, password } })).status()).toBe(201);
  const { data: { token } } = await (await api.post(`${API_BASE}/auth/login`, { data: { email, password } })).json();
  const headers = { Authorization: `Bearer ${token}` };

  // ── Workspace → Space → List ────────────────────────────────────────────────
  const ws = (await (await api.post(`${API_BASE}/workspaces`, { headers, data: { name: `WS ${suffix}`, slug: `ws-${suffix}` } })).json()).data;
  const workspaceId = ws.Id ?? ws.id;
  const project = (await (await api.post(`${API_BASE}/projects`, { headers, data: { workspaceId, name: `P ${suffix}`, key: `FM${suffix.slice(-4).toUpperCase()}`, type: 'KANBAN' } })).json()).data;
  const spaceId = project.Id ?? project.id;
  const list = (await (await api.post(`${API_BASE}/lists`, { headers, data: { workspaceId, spaceId, folderId: null, name: 'Intake', position: 0 } })).json()).data;
  const listId = list.id ?? list.Id;

  // ── Public form with conditional logic ──────────────────────────────────────
  const config = {
    fields: [
      { key: 'summary', label: 'Summary', type: 'short_text', required: true },
      { key: 'kind',    label: 'Kind',    type: 'select',     required: true, options: ['bug', 'idea'] },
      { key: 'steps',   label: 'Steps',   type: 'long_text',  required: true },
    ],
    branching: [
      { fieldKey: 'steps', action: 'show', when: { fieldKey: 'kind', op: 'equals', value: 'bug' } },
    ],
  };
  const formRes = await api.post(`${API_BASE}/forms`, {
    headers,
    data: {
      workspaceId, scopeType: 'LIST', scopeId: listId, name: 'Public Intake',
      config, targetListId: listId,
      fieldMapping: { summary: { kind: 'task', target: 'title' } },
      isPublic: true, publicSlug: slug, authRequired: false,
    },
  });
  expect(formRes.status(), 'create form').toBe(201);

  // ── Browser: render the PUBLIC form (no login) ──────────────────────────────
  const ctx  = await browser.newContext();   // fresh — no session cookie
  const page = await ctx.newPage();
  await page.goto(`/forms/${slug}`);

  await expect(page.getByRole('heading', { name: 'Public Intake' })).toBeVisible({ timeout: 15_000 });

  // "steps" is HIDDEN initially (kind unset) and for "idea".
  const stepsField = page.locator('[data-field-key="steps"]');
  await expect(stepsField).toHaveCount(0);

  await page.locator('[data-field-key="kind"] select').selectOption('idea');
  await expect(stepsField).toHaveCount(0);   // still hidden for idea

  // Selecting "bug" REVEALS "steps".
  await page.locator('[data-field-key="kind"] select').selectOption('bug');
  await expect(stepsField).toBeVisible();

  // Fill + submit.
  await page.locator('[data-field-key="summary"] input').fill(summary);
  await page.locator('[data-field-key="steps"] textarea').fill('Open app, it crashes.');
  await page.getByRole('button', { name: /submit/i }).click();

  // Thank-you state.
  await expect(page.getByText(/thanks/i)).toBeVisible({ timeout: 15_000 });

  // ── API proof: a task with the mapped title landed in the target list ────────
  await expect.poll(async () => {
    const tasks = (await (await api.get(`${API_BASE}/hierarchy/everything?nodeType=LIST&nodeId=${listId}`, { headers })).json()).data as any[];
    return tasks.map((t) => t.Title ?? t.title);
  }, { message: 'submitted task in target list', timeout: 20_000 }).toContain(summary);

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  await ctx.close();
  const wsDel = await api.delete(`${API_BASE}/workspaces/${workspaceId}`, { headers });
  expect([204, 404]).toContain(wsDel.status());
  await api.dispose();
});
```

- [ ] Run: the project's e2e command for a single spec against `ProjectFlow_Test` (same invocation the templates/views specs use, e.g. `npx playwright test e2e/forms.spec.ts`). Expected: PASS (1 test) — branching toggles "steps", submit creates the mapped task.

- [ ] Commit:
```
git add e2e/forms.spec.ts
git commit -m "test(7c): e2e — conditional-logic form hides/shows questions + submit creates a task (§6.5)"
```

---

### Task 13: Slice verification + DECISIONS.md

**Files:**
- Modify: `DECISIONS.md` (append a Phase 7c entry)

Steps:

- [ ] Run the full slice verification on local Docker `ProjectFlow_Test`:
  - `npm test --workspace apps/api` — Expected: PASS (existing suite + new `branching`/`mapping` unit tests).
  - `npm run test:integration --workspace apps/api -- forms` then the full integration suite — Expected: PASS (existing + `forms.integration.test.ts`).
  - `npm test --workspace apps/next-web` — Expected: PASS (unit + `formBranching` + `messages.unit` parity).
  - `npm run build --workspace apps/api` and `npm run build --workspace apps/next-web` — Expected: both PASS.
  - The forms e2e — Expected: PASS.

- [ ] Append a `DECISIONS.md` entry logging: the JSON `Config`/`FieldMapping`/`Answers` columns (mirrors `SavedViews`/`Templates`); the filtered-unique `UQ_Forms_PublicSlug`; the `/forms/public/*` pair as the ONLY unauthenticated surface (no blanket `app.use('/forms/*', authMiddleware)`; protected handlers gate inline like avatars) + the stateless HMAC read token (with the Phase 12 hardening deferral: rate-limit/captcha/expiry); the optional-auth submit (Bearer attributes the submission, `AuthRequired` rejects anonymous → 401); required-on-VISIBLE validation + `stripHiddenAnswers`; reporter fallback to the form creator for anonymous submits; the public route placed OUTSIDE `(app)`; template-apply on submit reusing `templateService.apply`; the GraphQL mirror covering metadata only (render/submit stay REST). DB-execution-policy note: all DB work ran ONLY against local Docker `ProjectFlow_Test`.

- [ ] Commit:
```
git add DECISIONS.md
git commit -m "docs(7c): DECISIONS entry — forms intake, public unauth surface, branching/mapping, template-on-submit"
```

---

## Definition of Done

Per-slice DoD (spec §3) + BUILD_PLAN acceptance (spec §6.5):

- [ ] **BUILD_PLAN acceptance (§6.5):** a form with conditional logic hides/shows questions and creates a task on submit (proven by `e2e/forms.spec.ts`).
- [ ] Migration `0042_forms.sql` is idempotent, GO-batched, and **reversible** via `rollback/0042_forms.down.sql` (apply→rollback→re-apply verified clean); exact table/column names from spec §6.1.
- [ ] SP-per-op for every operation (`usp_Form_Create`/`Update`/`GetById`/`GetBySlug`/`GetWorkspaceId`/`List`/`Delete`, `usp_FormSubmission_Create`/`ListByForm`), `CREATE OR ALTER` + `SET NOCOUNT ON` + TRY/CATCH, `SELECT *` of affected rows.
- [ ] REST is the primary surface; the **public render/submit pair (`GET /forms/public/:slug`, `POST /forms/public/:slug/submit`) is the ONLY unauthenticated surface** (no blanket `authMiddleware` on `/forms/*`; protected CRUD gates inline). The **GraphQL mirror** (`forms`/`form`/`formSubmissions` + `createForm`/`updateForm`/`deleteForm`) delegates to the **one shared `FormService`**.
- [ ] Authorization fail-closed: workspace-member + object-level ACL (`accessService.resolveOrNull` + `LEVEL_ORDER`) on the form's scope for CRUD; the scoped HMAC read token + optional `AuthRequired` on the public submit.
- [ ] Submit composes EXISTING create paths (`TaskRepository.create` in `TargetListId`, `customFieldService.setValue` for mapped custom fields, `templateService.apply` for the optional template) — never raw SQL — and records a `FormSubmissions` row.
- [ ] Pure helpers unit-tested: the branching evaluator (show/hide over prior answers, required-on-visible) and the field→task mapper (native vs custom-field split). Integration tests cover submit→task-in-target-list-with-mapped-fields (+ template), auth-required-rejects-anonymous, and hidden-required-not-enforced. ≥1 Playwright e2e for the headline flow — all green.
- [ ] `@projectflow/types` updated (`Form`/`FormSubmission`/`FormConfig`/`FormField`/`FormBranchingRule`/`FormFieldMapping`/`PublicFormView` + input/result types).
- [ ] Frontend: form **builder** (drag field types + conditional branching + target list + mapping + optional template) under `(app)`; **public renderer** at `app/forms/[slug]/` **OUTSIDE `(app)`** (sessionless, evaluates branching client-side via the shared evaluator). Next 16.2.7 docs read first per `apps/next-web/AGENTS.md`.
- [ ] i18n: new `Forms` namespace in **en.json + id.json** (real Indonesian); `messages.unit` parity green.
- [ ] All DB work (migrations, SP deploy, integration, e2e) ran **ONLY against local Docker `ProjectFlow_Test`** — never the prod-pointing `apps/api/.env`.
- [ ] `DECISIONS.md` entry logs the mechanism choices + any deviations. **Stop for review/merge.** (7c is independent of the 7a/7b CRDT stack.)

---

## Self-Review

**Spec coverage (§6):**
- §6.1 data model — `0042_forms.sql` creates `Forms` (`Config`/`FieldMapping` JSON, `TargetListId`, `TemplateId` NULL, `IsPublic`/`PublicSlug`/`AuthRequired`, soft-delete) + `FormSubmissions` (`Answers`, `CreatedTaskId` NULL, `SubmittedById` NULL, `SubmittedAt DATETIME2`) — exact columns from the spec. ✅
- §6.2 backend — form CRUD (Task 2/5/6/8); **public render** by `PublicSlug` with a scoped read token + optional `AuthRequired` (Task 5/6); **submit** → validate against config + branching → create a task in `TargetListId` with `FieldMapping` + optional `template.service.apply` → record `FormSubmissions` (Task 5); public render/submit are the only unauthenticated surface (Task 6 + server.ts wiring); REST + GraphQL mirror (Task 8). ✅
- §6.3 frontend — builder with field types + conditional show/hide branching + target list + field mapping + optional template (Task 10); public renderer evaluating branching client-side + posting the submission (Task 11). ✅
- §6.4 tests — unit (branching show/hide + field→task mapping, Task 4); integration (submit→task in target list with mapped fields + template; auth-required rejects anonymous, Task 7); e2e (conditional logic hides/shows + creates a task, Task 12). ✅
- §6.5 acceptance — covered by `e2e/forms.spec.ts`. ✅
- §2/§7 note — 7c is independent of the CRDT stack; no Yjs/Hocuspocus/tldraw dependencies introduced. ✅
- §8 deferrals — form hardening (analytics/captcha/rate-limit/token-expiry beyond `AuthRequired`) explicitly logged as the Phase 12 follow-up in the DECISIONS entry. ✅

**Placeholder scan:** Full code is given for the migration + rollback (exact columns), all 9 SPs, `form.branching.ts`/`form.mapping.ts` (+ their unit tests), `form.errors.ts`, `form.repository.ts`, `form.service.ts` (render + submit), `form.routes.ts` (incl. the public render+submit that bypass auth), `form.schema.ts`, the integration test, the server actions + sessionless public fetch + client `formBranching.ts`, `FormBuilder.tsx` (all 8 field types, no "handle the rest similarly"), the authed pages, `PublicFormRenderer.tsx` (`renderInput` enumerates every field type), the public route page, the e2e, and full en+id i18n. The only adapt-to-real-name notes are for existing web loaders (`loadListsForWorkspace`/`getWorkspaceProjectContext`) whose exact export names the implementer confirms against `apps/next-web/src/server/` — flagged inline, not left as code placeholders.

**Type/name consistency:** Migration `0042` and table/column names match spec §6.1 exactly (`Forms`, `FormSubmissions`, `Config`, `FieldMapping`, `TargetListId`, `TemplateId`, `IsPublic`, `PublicSlug`, `AuthRequired`, `Answers`, `CreatedTaskId`, `SubmittedById`, `SubmittedAt`). DTO field names (`config`/`fieldMapping`/`targetListId`/`templateId`/`isPublic`/`publicSlug`/`authRequired`/`createdTaskId`/`submittedById`/`submittedAt`) are consistent across `packages/types`, repository row mappers, service, routes, GraphQL mirror, and frontend. SP parameter names match the repository `execSpOne` calls. The branching evaluator + field-mapper signatures are identical between the API (`form.branching.ts`/`form.mapping.ts`) and the client copy (`lib/formBranching.ts`), so server validation and client rendering hide/show identically. REST mounting (`app.route('/forms', formRoutes)` with NO blanket `authMiddleware`) matches the avatars/git-webhooks public-route precedent, keeping `/forms/public/*` open while every protected handler gates inline. The public page lives at `app/forms/[slug]/` — outside `(app)` — as the spec and `apps/next-web/AGENTS.md` require.
