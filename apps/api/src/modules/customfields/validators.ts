import type { CustomFieldConfig, CustomFieldType } from '@projectflow/types';

export interface ValidationResult { valid: boolean; code?: string; message?: string; }

const okResult: ValidationResult = { valid: true };
const fail = (code: string, message: string): ValidationResult => ({ valid: false, code, message });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[\d\s().-]{6,20}$/;

// Minimal ISO-4217 set used in the product; extend as needed.
const CURRENCY_CODES = new Set([
  'USD','EUR','GBP','JPY','IDR','SGD','AUD','CAD','CHF','CNY','INR','MYR','THB','PHP','VND','KRW','HKD','NZD',
]);

function isString(v: unknown): v is string { return typeof v === 'string'; }
function isFiniteNumber(v: unknown): v is number { return typeof v === 'number' && Number.isFinite(v); }

/**
 * Validates a decoded custom-field value against its type + config.
 * `people` membership and `dropdown`/`labels` option existence beyond the
 * config are enforced here; cross-table checks (workspace membership) happen
 * in the service before calling the SP.
 */
export function validateFieldValue(
  type: CustomFieldType,
  value: unknown,
  config: CustomFieldConfig | null,
): ValidationResult {
  switch (type) {
    case 'text':
    case 'text_area':
      return isString(value) ? okResult : fail('NOT_STRING', 'Value must be a string');
    case 'url':
      if (!isString(value)) return fail('NOT_STRING', 'Value must be a string');
      try { new URL(value); return okResult; } catch { return fail('BAD_URL', 'Value must be a valid URL'); }
    case 'email':
      return isString(value) && EMAIL_RE.test(value) ? okResult : fail('BAD_EMAIL', 'Value must be a valid email');
    case 'phone':
      return isString(value) && PHONE_RE.test(value) ? okResult : fail('BAD_PHONE', 'Value must be a valid phone number');
    case 'number':
      return isFiniteNumber(value) ? okResult : fail('NOT_NUMBER', 'Value must be a number');
    case 'currency': {
      if (!isFiniteNumber(value)) return fail('NOT_NUMBER', 'Value must be a number');
      const code = config?.currencyCode;
      if (!code || !CURRENCY_CODES.has(code)) return fail('BAD_CURRENCY', 'Field has no valid ISO-4217 currency code');
      return okResult;
    }
    case 'checkbox':
      return typeof value === 'boolean' ? okResult : fail('NOT_BOOLEAN', 'Value must be a boolean');
    case 'date': {
      if (!isString(value)) return fail('NOT_STRING', 'Value must be an ISO date string');
      const t = Date.parse(value);
      return Number.isNaN(t) ? fail('BAD_DATE', 'Value must be a parseable date') : okResult;
    }
    case 'dropdown': {
      if (!isString(value)) return fail('NOT_STRING', 'Value must be an option id');
      const ids = new Set((config?.options ?? []).map((o) => o.id));
      return ids.has(value) ? okResult : fail('BAD_OPTION', 'Value is not a valid option');
    }
    case 'labels': {
      if (!Array.isArray(value) || !value.every(isString)) return fail('NOT_STRING_ARRAY', 'Value must be an array of option ids');
      const ids = new Set((config?.options ?? []).map((o) => o.id));
      return value.every((v) => ids.has(v)) ? okResult : fail('BAD_OPTION', 'One or more options are invalid');
    }
    case 'rating': {
      const max = config?.max ?? 5;
      return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max
        ? okResult : fail('BAD_RATING', `Value must be an integer between 0 and ${max}`);
    }
    case 'people':
      return Array.isArray(value) && value.every(isString) ? okResult : fail('NOT_STRING_ARRAY', 'Value must be an array of user ids');
    case 'progress_manual':
      return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100
        ? okResult : fail('BAD_PROGRESS', 'Value must be an integer between 0 and 100');
    case 'progress_auto':
      return fail('PROGRESS_AUTO_READONLY', 'progress_auto is computed and cannot be set directly');
    case 'relationship':
      // Relationship values live in the TaskRelationships link table and are set
      // via the dedicated /relationships endpoints, not the generic value path.
      return fail('RELATIONSHIP_READONLY', 'relationship values are set via the relationships endpoints');
    case 'rollup':
      // Rollup is computed (read-only) from related tasks, like progress_auto.
      return fail('ROLLUP_READONLY', 'rollup is computed and cannot be set directly');
    case 'location': {
      if (typeof value !== 'object' || value === null || Array.isArray(value))
        return fail('NOT_LOCATION', 'Value must be a { lat, lng, label } object');
      const v = value as Record<string, unknown>;
      if (!isFiniteNumber(v.lat) || v.lat < -90 || v.lat > 90)
        return fail('BAD_LATITUDE', 'lat must be a finite number between -90 and 90');
      if (!isFiniteNumber(v.lng) || v.lng < -180 || v.lng > 180)
        return fail('BAD_LONGITUDE', 'lng must be a finite number between -180 and 180');
      if (!isString(v.label))
        return fail('BAD_LABEL', 'label must be a string');
      return okResult;
    }
    default:
      return fail('UNKNOWN_TYPE', `Unknown field type: ${type}`);
  }
}

const ROLLUP_FUNCTIONS = new Set(['sum', 'avg', 'count', 'min', 'max', 'first', 'concat']);

/**
 * Validates a field's CONFIG at create/update time (NOT the per-task value).
 * Most field types accept any config; only `relationship` and `rollup` have
 * required-shape config introduced in Phase 5b. Returns `okResult` for types
 * with no config constraints so callers can wire this unconditionally.
 */
export function validateFieldConfig(
  type: CustomFieldType,
  config: CustomFieldConfig | null,
): ValidationResult {
  switch (type) {
    case 'relationship': {
      const target = config?.relationshipTargetType;
      if (target !== 'any' && target !== 'list')
        return fail('BAD_RELATIONSHIP_CONFIG', "relationship requires relationshipTargetType 'any' or 'list'");
      if (target === 'list' && !isString(config?.relationshipTargetListId))
        return fail('BAD_RELATIONSHIP_CONFIG', "relationshipTargetListId is required when relationshipTargetType is 'list'");
      return okResult;
    }
    case 'rollup': {
      if (!isString(config?.rollupRelationshipFieldId))
        return fail('BAD_ROLLUP_CONFIG', 'rollup requires rollupRelationshipFieldId');
      const src = config?.rollupSourceField;
      if (!src || (src.kind !== 'builtin' && src.kind !== 'custom') || !isString(src.key))
        return fail('BAD_ROLLUP_CONFIG', 'rollup requires a valid rollupSourceField');
      if (!config?.rollupFunction || !ROLLUP_FUNCTIONS.has(config.rollupFunction))
        return fail('BAD_ROLLUP_CONFIG', 'rollup requires a valid rollupFunction');
      return okResult;
    }
    default:
      return okResult;
  }
}
