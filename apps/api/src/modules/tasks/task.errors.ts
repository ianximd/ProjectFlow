export class MultipleAssigneesDisabledError extends Error {
  constructor() {
    super('This space does not allow multiple assignees');
    this.name = 'MultipleAssigneesDisabledError';
  }
}
