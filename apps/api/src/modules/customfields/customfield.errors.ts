import type { CustomField } from '@projectflow/types';

/** Per-type or config validation failure on a value-set. */
export class FieldValidationError extends Error {
  constructor(public readonly fieldCode: string, message: string) {
    super(message);
    this.name = 'FieldValidationError';
  }
}

/** A transition into a DONE-category status is blocked by unfilled required fields. */
export class RequiredFieldsUnmetError extends Error {
  constructor(public readonly missing: Array<Pick<CustomField, 'id' | 'name'>>) {
    super('Required custom fields must be filled before this status');
    this.name = 'RequiredFieldsUnmetError';
  }
}
