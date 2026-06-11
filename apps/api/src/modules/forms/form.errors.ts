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
