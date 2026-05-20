export type ActionOk<T> = T extends void ? { ok: true } : { ok: true; data: T };
export interface ActionFail { ok: false; error: string; code?: string; status?: number }
export type ActionResult<T = void> = ActionOk<T> | ActionFail;
