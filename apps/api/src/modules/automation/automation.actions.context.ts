/**
 * Canonical ActionContext and loop-guard re-emit helper for the automation
 * action layer.
 *
 * NOTE: apps/api/src/modules/automation/automation.actions.ts currently
 * defines its own legacy ActionContext ({workspaceId, projectId, loop}).
 * That file will be updated to import from here in Task 5 of Phase 6c.
 * Until then, both co-exist; the apps/api tsc build uses each file's own
 * definition without a direct collision (different module scopes).
 */
import {
  emitAutomationEvent,
  type AutomationDomainEvent,
  type LoopContext,
} from './automation.bus.js';

// ── System actor ──────────────────────────────────────────────────────────────

/**
 * Fallback actor id used for system-initiated actions (no human actor).
 * Set via the SYSTEM_USER_ID environment variable; null when unset.
 */
export const SYSTEM_USER_ID: string | null = process.env.SYSTEM_USER_ID ?? null;

// ── ActionContext ─────────────────────────────────────────────────────────────

/**
 * Runtime context passed to every action executor. Contains enough information
 * to scope mutations, enforce the loop guard, and re-emit downstream events.
 */
export interface ActionContext {
  /** The automation rule that triggered this action batch. */
  ruleId:      string;
  workspaceId: string;
  projectId:   string | null;
  /** Causal depth + chain — propagated from the inbound domain event. */
  loop:        LoopContext;
  /**
   * The flattened payload of the triggering event (taskId, actorId,
   * reporterId, listId, fromStatus, toStatus, field, …).
   */
  payload:     Record<string, unknown>;
}

// ── Helper: resolve the acting user id ───────────────────────────────────────

/**
 * Returns the actorId from the event payload when available; falls back to
 * SYSTEM_USER_ID. Returns null when neither is set.
 */
export function resolveActor(ctx: ActionContext): string | null {
  return (ctx.payload['actorId'] as string | undefined) ?? SYSTEM_USER_ID;
}

// ── Helper: loop-guarded re-emit ─────────────────────────────────────────────

/**
 * Emit a downstream domain event one causal level deeper. Stamps the current
 * rule's id onto the causation chain and increments the depth, so the loop
 * guard can detect self-retriggering and depth exhaustion.
 *
 * @param ctx   The current action context (carries ruleId + loop state).
 * @param event The domain event to emit, minus the `loop` field (this
 *              function fills it in). Must be one of the types in the
 *              AutomationDomainEvent union.
 */
export async function reEmit(
  ctx:   ActionContext,
  event: Omit<AutomationDomainEvent, 'loop'>,
): Promise<void> {
  await emitAutomationEvent({
    ...event,
    loop: {
      depth:          ctx.loop.depth + 1,
      causationChain: [...ctx.loop.causationChain, ctx.ruleId],
    },
  } as AutomationDomainEvent);
}
