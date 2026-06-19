# Phase 11c — Summarization + AI Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `ai_field` custom-field type (6 subtypes via structured output) reusing the Phase-2 custom_fields tables, plus an on-demand `POST /ai/summarize` for a task thread / doc / inbox.

**Architecture:** `ai_field` reuses `CustomFields` (`type='ai_field'`, `config={subtype,sourceField?,prompt?}`) + `TaskCustomFieldValues` (`value` JSON = `{output,subtype,computedAt,stale}`) — **no new field table**. Values compute via `gateway.completeStructured(subtypeSchema)`; recompute as a debounced sibling job on task change + on demand. Summarize is a thin retrieve-or-load → `complete` endpoint.

**Tech Stack:** As 11a/11b. Touches the custom-fields module (api + web) and the indexing debounce pattern.

**Spec:** `docs/superpowers/specs/2026-06-18-ai-layer-phase11-design.md` §3.4, §6 "11c", §7. **Depends on 11a (gateway, structured output, index worker).**

---

### Task 0: Reconciliation (FIRST)

- [ ] Confirm the 4 custom-field type touchpoints (Explore-verified 2026-06-19):
  1. SQL CHECK `CK_CustomFields_Type` in `infra/sql/migrations/0030_custom_fields.sql` — **lags the TS enum** (no `relationship`/`rollup`/`location`); adding `ai_field` needs a CHECK-extending migration.
  2. TS union `CustomFieldType` in `packages/types/index.ts` (~line 1319).
  3. Zod enum `TYPE` in `apps/api/src/modules/customfields/customfield.routes.ts` (~line 14).
  4. Value validator `validateFieldValue` / `validateFieldConfig` in `apps/api/src/modules/customfields/validators.ts`.
- [ ] Confirm `TaskCustomFieldValues(TaskId, FieldId, Value NVARCHAR(MAX), UpdatedAt)` shape and the read-only-type pattern (e.g. `progress_auto`, `rollup` return `*_READONLY`).
- [ ] Confirm `FieldManager.tsx` at `apps/next-web/src/components/custom-fields/FieldManager.tsx` (type picker `TYPES` ~line 27, per-type config sub-forms, `useTranslations('CustomFields')`).
- [ ] Confirm `gateway.completeStructured` exists (11a) and decide how FakeProvider returns schema-valid canned objects per `schemaName` (extend the 11a stub registry).

---

## File Structure

```
infra/sql/migrations/0065_ai_field_type.sql          # extend CK_CustomFields_Type to include 'ai_field'
infra/sql/migrations/rollback/0065_ai_field_type.down.sql
apps/api/src/modules/ai/fields/
  ai-field.schema.ts        # 6 subtype JSON schemas + zod config validator
  ai-field.service.ts       # compute(taskId, fieldId) via completeStructured; recompute job
apps/api/src/modules/ai/summarize/summarize.service.ts
apps/api/src/modules/ai/ai.routes.ts                 # +POST /ai/summarize, +POST /ai/fields/:id/recompute
apps/api/src/modules/customfields/validators.ts      # +ai_field branch (read-only value)
apps/api/src/modules/customfields/customfield.routes.ts  # +ai_field in Zod enum
packages/types/index.ts                              # +'ai_field' in union
apps/api/src/modules/ai/index/ai-index.worker.ts     # recompute hook on task change (or sibling job)
apps/api/src/modules/ai/__tests__/ai-field.integration.test.ts
apps/api/src/modules/ai/__tests__/ai-field.security.integration.test.ts
apps/api/src/modules/ai/__tests__/summarize.integration.test.ts
apps/next-web/src/components/custom-fields/FieldManager.tsx   # +ai_field type + subtype picker
apps/next-web/src/components/custom-fields/AiFieldCell.tsx    # value + "regenerate"
apps/next-web/messages/en.json / id.json             # +Ai.fields.* (parity)
```

---

### Task 1: Migration `0065_ai_field_type.sql` (extend CHECK)

**Files:** Create `infra/sql/migrations/0065_ai_field_type.sql` + rollback.

- [ ] **Step 1: Write** — drop + recreate `CK_CustomFields_Type` including the full current TS list **plus** `ai_field` (the CHECK currently lags; bring it forward in one go):

```sql
-- 0065_ai_field_type.sql — bring CK_CustomFields_Type up to the TS enum + add 'ai_field'.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CustomFields_Type')
    ALTER TABLE dbo.CustomFields DROP CONSTRAINT CK_CustomFields_Type;
GO
ALTER TABLE dbo.CustomFields ADD CONSTRAINT CK_CustomFields_Type CHECK (Type IN (
  'text','text_area','number','currency','checkbox','date','url','email','phone',
  'dropdown','labels','rating','people','progress_manual','progress_auto',
  'relationship','rollup','location','ai_field'
));
GO
```

- [ ] **Step 2: Rollback** restores the CHECK without `ai_field` (same list minus `ai_field`) + `DELETE FROM dbo.MigrationHistory WHERE [FileName]='0065_ai_field_type.sql'`.
- [ ] **Step 3: Run `npm run db:migrate` on local Docker — applied. Step 4: Commit.** `feat(11c): 0065 extend CK_CustomFields_Type (catch up TS enum + ai_field)`

---

### Task 2: `ai-field.schema.ts` — 6 subtype schemas (TDD)

**Files:** Create `apps/api/src/modules/ai/fields/ai-field.schema.ts`; Test `__tests__/ai-field.integration.test.ts` (schema part)

Subtypes: `summary | sentiment | translate | action_items | categorize | custom`.

- [ ] **Step 1: Failing test** — `aiFieldSchemas['sentiment'].jsonSchema` is a JSON schema whose FakeProvider canned object validates; `validateAiFieldConfig({subtype:'sentiment'})` passes, `{subtype:'bogus'}` fails.
- [ ] **Step 2: Implement** — a `Record<subtype, {jsonSchema, zodOutput}>`. Shapes: `sentiment` → `{ label:'positive'|'neutral'|'negative', score:number }`; `summary` → `{ summary:string }`; `action_items` → `{ items:string[] }`; `categorize` → `{ category:string }`; `translate` → `{ text:string, targetLang:string }`; `custom` → `{ output:string }`. Plus `validateAiFieldConfig(config)` (zod: `subtype` enum, optional `sourceField`, optional `prompt`).
- [ ] **Step 3: Run — PASS. Step 4: Register canned objects in FakeProvider** keyed by `schemaName` so `completeStructured({schemaName:'ai_field.sentiment'})` returns `{label:'neutral',score:0}` etc. (deterministic). **Step 5: Commit.** `feat(11c): ai_field subtype schemas + Fake canned outputs`

---

### Task 3: `ai-field.service.ts` — compute + value validator wiring

**Files:** Create `ai-field.service.ts`; Modify `customfields/validators.ts`, `customfields/customfield.routes.ts`, `packages/types/index.ts`; Test `__tests__/ai-field.integration.test.ts`

- [ ] **Step 1: Add `'ai_field'`** to the TS union (`packages/types/index.ts`) and the Zod `TYPE` enum (`customfield.routes.ts`).
- [ ] **Step 2: Add the `ai_field` branch to `validateFieldValue`** — read-only (user cannot directly set it; return an `AI_FIELD_READONLY`-style result), mirroring `progress_auto`/`rollup`. Add `validateFieldConfig` branch calling `validateAiFieldConfig`.
- [ ] **Step 3: Implement `ai-field.service.ts`**:

```ts
async compute(userId: string, workspaceId: string, taskId: string, fieldId: string) {
  const field = await customFieldRepo.getById(fieldId);             // type='ai_field', config={subtype,...}
  const { subtype, sourceField, prompt } = JSON.parse(field.Config);
  const sourceText = await this.gatherSource(taskId, sourceField);  // task desc/thread or another field's value
  const { jsonSchema } = aiFieldSchemas[subtype];
  const output = await this.gateway.completeStructured(
    { workspaceId, userId, feature: 'ai_field' },
    { schemaName: `ai_field.${subtype}`, jsonSchema, prompt: prompt ?? defaultPrompt(subtype, sourceText) });
  await customFieldValueRepo.set(taskId, fieldId,
    JSON.stringify({ output, subtype, computedAt: new Date().toISOString(), stale: false }));
  return output;
}
```

- [ ] **Step 4: Recompute trigger** — in the `ai-index.worker` task-change path (or a sibling debounced job keyed `ai:field:${taskId}`), enumerate the task's `ai_field`s and `compute` each. Mark `stale:true` immediately on change, clear on recompute. ponytail: reuse the index debounce; don't add a second queue.
- [ ] **Step 5: Test** — create an `ai_field` (sentiment) on a List, create a task, run compute, assert the stored value JSON validates the subtype schema. Run — PASS. **Step 6: Commit.** `feat(11c): ai_field compute via completeStructured + read-only value validation + recompute`

---

### Task 4: Security test (computed values respect VIEW)

**Files:** Test `__tests__/ai-field.security.integration.test.ts`

- [ ] **Step 1: Write** — assert a user who cannot VIEW a task cannot read its computed `ai_field` value via the field-value read path, and that `summarize` (Task 5) refuses cross-tenant/forbidden targets. (Compute runs privileged server-side; the boundary is the **read** path — the existing custom-field-value access checks — assert they hold.)
- [ ] **Step 2: Run — PASS. Step 3: Commit.** `test(11c): ai_field value reads respect object VIEW (no leak via computed fields)`

---

### Task 5: `POST /ai/summarize` (task thread / doc / inbox)

**Files:** Create `summarize/summarize.service.ts`; Modify `ai.routes.ts`; Test `__tests__/summarize.integration.test.ts`

- [ ] **Step 1: Failing route test** — owner summarizes a task thread → 200 `{ summary }`; user without VIEW on the target → 403/empty; no `ai.use` → 403.
- [ ] **Step 2: Implement `summarize(userId, workspaceId, target)`** where `target={kind:'task'|'doc'|'inbox', id}`: **gate the target with `accessService.can(userId, scopeType, scopeId, 'VIEW')`** before loading content, gather text (task comment thread / doc body / inbox notifications the user can see), `gateway.complete(feature:'ai_field')`, return `{ summary }`.
- [ ] **Step 3: Add `POST /ai/summarize`** to `ai.routes.ts` (`requirePermission('ai.use', ...)`, zod `{ workspaceId, kind, id }`).
- [ ] **Step 4: Run — PASS. Step 5: Commit.** `feat(11c): POST /ai/summarize (VIEW-gated task/doc/inbox)`

---

### Task 6: Frontend — FieldManager type + AiFieldCell + i18n

**Files:** Modify `FieldManager.tsx`; Create `AiFieldCell.tsx`; Modify `messages/en.json`, `id.json`

- [ ] **Step 1: Add `ai_field` to `FieldManager` `TYPES`** + a subtype `<select>` config sub-form (mirror the `relationship`/`rollup` conditional config blocks). Labels via `useTranslations('CustomFields')` — add keys to both locales.
- [ ] **Step 2: `AiFieldCell.tsx`** — renders the computed `output` per subtype (sentiment chip, summary text, action-items list), shows a `stale` indicator + a "Regenerate" button calling a `recomputeAiField(taskId, fieldId)` server action (POSTs `/ai/fields/:id/recompute`).
- [ ] **Step 3: Add `Ai.fields.*` keys to en + id (parity).**
- [ ] **Step 4: Web unit test** (cell renders each subtype; regenerate calls action). Run — PASS. **Step 5: Commit.** `feat(11c): FieldManager ai_field + subtype picker + AiFieldCell + en/id i18n`

---

### Task 7: e2e + DoD

- [ ] **Step 1: Playwright** — create an `ai_field` (sentiment) on a List, create a task with a description, regenerate, assert the cell shows a sentiment value; summarize a task thread and assert a summary renders.
- [ ] **Step 2:** tsc (api) + Next build clean; full `npx vitest run apps/api/src/modules/ai` green; en/id parity.
- [ ] **Step 3:** DECISIONS.md entry (ai_field reuses Phase-2 tables; read-only computed; subtypes; recompute via index debounce).
- [ ] **Step 4: Final opus whole-slice review** (do NOT skip) — focus the value-read access path + summarize VIEW gate.
- [ ] **Step 5: ff-merge to main locally, STOP for review** before 11d.

---

## Self-Review Notes
- No new field table (reuses `CustomFields`/`TaskCustomFieldValues`) — confirmed against spec §3.4.
- Compute runs privileged server-side; the security boundary is the **read** path + the summarize target VIEW gate — both tested.
- `AiRuns.Feature` CHECK already includes `ai_field`; summarize reuses it (no extra migration).
