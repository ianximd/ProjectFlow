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
