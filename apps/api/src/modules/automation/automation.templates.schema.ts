import { z } from 'zod';

// ── Token sets — kept in lockstep with the @projectflow/types automation unions.
// The catalog-integrity test asserts every template's tokens are members. ───────
export const TRIGGER_TYPES = [
  'TASK_CREATED', 'TASK_UPDATED', 'STATUS_CHANGED', 'FIELD_CHANGED',
  'ASSIGNEE_CHANGED', 'COMMENT_POSTED', 'SPRINT_STARTED', 'SPRINT_COMPLETED',
  'DUE_DATE_PASSED', 'DATE_ARRIVED', 'SCHEDULED', 'MANUAL', 'WEBHOOK',
] as const;

export const CONDITION_TYPES = [
  'ISSUE_MATCHES_FILTER', 'FIELD_EQUALS', 'FIELD_NOT_EQUALS',
  'USER_HAS_ROLE', 'IN_SPRINT', 'NOT_IN_SPRINT',
] as const;

export const OPERATORS = [
  'is', 'is_not', 'contains', 'gt', 'lt', 'before', 'after', 'is_set',
] as const;

export const ACTION_TYPES = [
  'CHANGE_STATUS', 'ASSIGN', 'UNASSIGN', 'SET_PRIORITY', 'POST_COMMENT',
  'SEND_NOTIFICATION', 'CALL_WEBHOOK', 'SET_FIELD', 'ADD_TAG',
  'CREATE_TASK', 'CREATE_SUBTASK', 'MOVE_TASK', 'APPLY_TEMPLATE',
] as const;

// ── Shared rule shape — the SINGLE source of truth for both the create/update
// routes and the template catalog (automation.routes.ts imports these). Lifted
// verbatim so "Use template" always yields a payload the create route accepts. ──
export const triggerSchema = z.object({
  type:           z.string().min(1),
  cron:           z.string().optional(),
  toStatus:       z.string().optional(),
  // FIELD_CHANGED: only fire when this field changed. Present on
  // AutomationTriggerConfig; without it here Zod silently strips it on save so a
  // tags-only trigger would degrade to fire-on-any-field-change (6a route gap).
  field:          z.string().optional(),
  hoursBeforeDue: z.number().optional(),
});

export const conditionOperatorSchema = z.enum([
  'is', 'is_not', 'contains', 'gt', 'lt', 'before', 'after', 'is_set',
]);

export const conditionSchema = z.object({
  type:     z.string().min(1),
  field:    z.string().optional(),
  operator: conditionOperatorSchema.optional(),
  value:    z.string().optional(),
  pql:      z.string().optional(),
});

// Recursive AND/OR condition tree (Phase 6b) — accepted alongside the legacy flat array.
export const conditionNodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({ op: z.enum(['AND', 'OR']), children: z.array(conditionNodeSchema) }),
    z.object({
      type:     z.string().min(1),
      field:    z.string().optional(),
      operator: conditionOperatorSchema.optional(),
      value:    z.string().optional(),
      pql:      z.string().optional(),
    }),
  ]),
);

// conditions accept EITHER the legacy flat array OR a recursive tree.
export const conditionsSchema = z.union([z.array(conditionSchema), conditionNodeSchema]);

export const actionSchema = z.object({
  type:           z.string().min(1),
  toStatus:       z.string().optional(),
  assigneeId:     z.string().optional(),
  priority:       z.string().optional(),
  message:        z.string().optional(),
  webhookUrl:     z.string().url().optional(),
  webhookEvent:   z.string().optional(),
  fieldId:        z.string().optional(),
  fieldValue:     z.any().optional(),
  tagId:          z.string().optional(),
  tagName:        z.string().optional(),
  title:          z.string().optional(),
  description:    z.string().optional(),
  newPriority:    z.string().optional(),
  targetListId:   z.string().optional(),
  targetPosition: z.number().optional(),
  templateId:     z.string().optional(),
  delaySeconds:   z.number().int().nonnegative().optional(),
});

/** The shape a saved rule's trigger+conditions+actions must satisfy. */
export const ruleShapeSchema = z.object({
  trigger:    triggerSchema,
  conditions: conditionsSchema,
  actions:    z.array(actionSchema).min(1),
});

export type RuleShape = z.infer<typeof ruleShapeSchema>;
