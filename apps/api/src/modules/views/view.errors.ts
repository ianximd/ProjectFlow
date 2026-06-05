export class ViewNotFoundError extends Error {
  constructor() { super('Saved view not found'); this.name = 'ViewNotFoundError'; }
}

export class ViewValidationError extends Error {
  constructor(msg: string) { super(msg); this.name = 'ViewValidationError'; }
}
