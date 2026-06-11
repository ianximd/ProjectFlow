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
