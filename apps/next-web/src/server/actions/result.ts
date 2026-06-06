export type ActionOk<T> = T extends void ? { ok: true } : { ok: true; data: T };
export interface ActionFail {
  ok: false;
  error: string;
  code?: string;
  status?: number;
  /** Curated error payload preserved from the API envelope (e.g. DEPENDENCY_BLOCKED `{ blockers }`). */
  details?: Record<string, unknown>;
}
export type ActionResult<T = void> = ActionOk<T> | ActionFail;
