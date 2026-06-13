export class DashboardNotFoundError extends Error {
  constructor(message = 'Dashboard not found') { super(message); this.name = 'DashboardNotFoundError'; }
}
export class DashboardValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'DashboardValidationError'; }
}
