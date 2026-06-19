# Phase 11e — Natural-Language Automation Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /ai/automations/draft` turns a sentence into a **valid, previewable** automation rule via `gateway.completeStructured(ruleShapeSchema)` — the exact Zod schema Phase 6 uses — which the user reviews in the existing builder and saves via the existing (re-validating, gated) create path.

**Architecture:** Pure structured-output mapping: sentence → `ruleShapeSchema` JSON → returned as a **draft preview** (NOT saved). Saving reuses the unchanged Phase-6 `automation create` path, so all existing validation + permission gates apply. The builder gains a "Describe in words" entry.

**Tech Stack:** As 11a. Touches the automation module (schema reuse) + the automation builder frontend.

**Spec:** `docs/superpowers/specs/2026-06-18-ai-layer-phase11-design.md` §6 "11e", §7. **Depends on 11a (completeStructured).**

---

### Task 0: Reconciliation (FIRST)

- [ ] Confirm `ruleShapeSchema` in `apps/api/src/modules/automation/automation.templates.schema.ts` (~line 91): `{ trigger: triggerSchema, conditions: conditionsSchema, actions: z.array(actionSchema).min(1) }`, plus the token allow-lists `TRIGGER_TYPES`/`CONDITION_TYPES`/`OPERATORS`/`ACTION_TYPES` at the top.
- [ ] Confirm the create path: `automation.routes.ts` `createSchema` (~line 34, adds `scopeType/workspaceId/projectId/name`) → `POST /` → `automationService.create(scopeType, workspaceId, projectId, name, trigger, conditions, actions)`.
- [ ] Confirm the builder frontend is inline in `apps/next-web/src/app/(app)/automations/automations-view.tsx` (imports `createAutomation`/`updateAutomation` from `@/server/actions/automations`); no separate `RuleBuilder.tsx`.
- [ ] Confirm how to convert a Zod schema → JSON schema for `completeStructured` (is `zod-to-json-schema` already a dep? If not, hand-author the JSON schema from the allow-list consts OR add the lib — prefer reusing an existing converter).

---

## File Structure

```
apps/api/src/modules/ai/nl-automation/
  nl-automation.service.ts      # sentence → completeStructured(ruleShapeSchema JSON) → validate → preview
  rule-json-schema.ts           # ruleShapeSchema → JSON schema for the gateway (+ allow-list enums)
apps/api/src/modules/ai/ai.routes.ts        # +POST /ai/automations/draft
apps/api/src/modules/ai/__tests__/nl-automation.integration.test.ts
apps/next-web/src/app/(app)/automations/automations-view.tsx   # "Describe in words" entry
apps/next-web/src/server/actions/ai.ts      # draftAutomation() server action
apps/next-web/messages/en.json / id.json     # +Ai.automation.* (parity)
```

---

### Task 1: `rule-json-schema.ts` — ruleShapeSchema as JSON schema

**Files:** Create `apps/api/src/modules/ai/nl-automation/rule-json-schema.ts`; Test `__tests__/nl-automation.integration.test.ts` (schema part)

- [ ] **Step 1: Failing test** — the produced JSON schema's enums match Phase 6 (trigger.type ∈ `TRIGGER_TYPES`, action.type ∈ `ACTION_TYPES`); a FakeProvider canned rule parses back through `ruleShapeSchema.safeParse(...).success === true`.
- [ ] **Step 2: Implement** — convert `ruleShapeSchema` to JSON schema (via the existing converter if present, else author it from the allow-list consts so the enums stay in sync with Phase 6). Export `ruleJsonSchema` + `ruleSchemaName = 'automation.rule'`.
- [ ] **Step 3: Register a FakeProvider canned rule** for `schemaName='automation.rule'` — a valid `ruleShapeSchema` instance (e.g. trigger `STATUS_CHANGED`→`Done`, one `SEND_NOTIFICATION` action) so structure assertions are exact.
- [ ] **Step 4: Run — PASS. Step 5: Commit.** `feat(11e): ruleShapeSchema→JSON schema + Fake canned rule`

---

### Task 2: `nl-automation.service.ts` — draft (preview, not saved)

**Files:** Create `nl-automation.service.ts`

- [ ] **Step 1: Implement:**

```ts
async draft(userId: string, workspaceId: string, sentence: string) {
  const raw = await aiGatewayService.completeStructured(
    { workspaceId, userId, feature: 'nl_automation' },
    { schemaName: ruleSchemaName, jsonSchema: ruleJsonSchema,
      prompt: `Convert this into an automation rule: "${sentence}"` });
  const parsed = ruleShapeSchema.safeParse(raw);          // re-validate with the REAL Phase-6 schema
  if (!parsed.success) return { ok: false as const, error: 'Could not produce a valid rule', issues: parsed.error.issues };
  return { ok: true as const, draft: parsed.data };        // NOT persisted — preview only
}
```

The draft is never saved here; the user saves via the existing create path (which re-validates + gates). NL stays purely additive and the security surface unchanged.

- [ ] **Step 2: Commit** (covered by Task 3 test). `feat(11e): NlAutomationService.draft — sentence→validated rule preview`

---

### Task 3: `POST /ai/automations/draft` + tests

**Files:** Modify `ai.routes.ts`; Test `__tests__/nl-automation.integration.test.ts`

- [ ] **Step 1: Failing route test** — owner POSTs `{ workspaceId, sentence }` → 200 `{ ok:true, draft }` where `draft` passes `ruleShapeSchema`; no `ai.use` → 403.
- [ ] **Step 2: Add `POST /ai/automations/draft`** to `ai.routes.ts` (`requirePermission('ai.use', { resolveWorkspace: resolveWorkspaceFromBody })`, zod `{ workspaceId, sentence: z.string().min(1) }`) → `nlAutomationService.draft`.
- [ ] **Step 3: Acceptance test** — the returned draft, POSTed to the **existing** `POST /automations` create route, persists (and per Phase-6 engine tests would run). Assert create succeeds with the draft payload.
- [ ] **Step 4: Run — PASS. Step 5: Commit.** `feat(11e): POST /ai/automations/draft (ai.use gated; draft saves via existing create path)`

---

### Task 4: Frontend "Describe in words" entry + i18n

**Files:** Modify `automations-view.tsx`; Modify `server/actions/ai.ts`, `messages/en.json`, `id.json`

- [ ] **Step 1: `draftAutomation(workspaceId, sentence)` server action** → POST `/ai/automations/draft`.
- [ ] **Step 2: Add a "Describe in words" input** to the automation builder dialog (`automations-view.tsx`): a sentence field + "Generate" → `draftAutomation` → populate the existing trigger/condition/action builder state with the returned draft (user reviews + edits before the normal Save). Reuse `@/lib/conditionTree` to load the draft conditions.
- [ ] **Step 3: Add `Ai.automation.*` keys to en + id (parity).**
- [ ] **Step 4: Web unit test** — entering a sentence populates the builder fields. Run — PASS. **Step 5: Commit.** `feat(11e): "Describe in words" automation entry + draftAutomation action + en/id i18n`

---

### Task 5: e2e + DoD

- [ ] **Step 1: Playwright** — open the automation builder, use "Describe in words", assert the builder fields populate from the draft, Save via the normal flow, and the rule appears in the list. (FakeProvider → deterministic draft.)
- [ ] **Step 2:** tsc (api) + Next build clean; full `npx vitest run apps/api/src/modules/ai` green; en/id parity.
- [ ] **Step 3:** DECISIONS.md entry (NL builder = structured-output → `ruleShapeSchema` re-validation → preview only; saving reuses the unchanged Phase-6 create path + gates).
- [ ] **Step 4: Final opus whole-slice review** (do NOT skip) — confirm draft is never persisted server-side and save goes through the existing gated path.
- [ ] **Step 5: ff-merge to main locally, STOP for review** before 11f.

---

## Self-Review Notes
- No new automation persistence/security surface — draft is preview-only; the existing create path is the single write path. Confirmed against spec §6 "11e".
- Enum drift risk: the JSON schema enums must stay sourced from the Phase-6 allow-list consts (Task 1) so NL can't emit out-of-vocabulary trigger/action types.
