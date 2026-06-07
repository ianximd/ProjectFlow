import { automationQueue } from './automation.queue.js';
import { AutomationRepository } from './automation.repository.js';
import { getRedis } from '../../shared/lib/redis.js';
import { subLogger } from '../../shared/lib/logger.js';

const log  = subLogger('automation-bus');
const repo = new AutomationRepository();

/** Max causal depth before the guard drops further enqueues. */
export const MAX_DEPTH = 5;
/** Per-(rule,entity) cooldown to damp tight thrash. */
export const COOLDOWN_SECONDS = 10;

export interface LoopContext {
  depth: number;
  causationChain: string[]; // ruleIds already fired in this causal chain
}

/** Typed domain events the service layer emits after commit. */
export type AutomationDomainEvent =
  | { type: 'TASK_CREATED';     workspaceId: string; projectId: string; taskId: string; actorId: string; reporterId?: string | null; payload?: Record<string, unknown>; loop?: LoopContext }
  | { type: 'STATUS_CHANGED';   workspaceId: string; projectId: string; taskId: string; actorId: string; reporterId?: string | null; fromStatus: string | null; toStatus: string; payload?: Record<string, unknown>; loop?: LoopContext }
  | { type: 'FIELD_CHANGED';    workspaceId: string; projectId: string; taskId: string; actorId: string; field: string; from: unknown; to: unknown; payload?: Record<string, unknown>; loop?: LoopContext }
  | { type: 'ASSIGNEE_CHANGED'; workspaceId: string; projectId: string; taskId: string; actorId: string; from: string | null; to: string | null; payload?: Record<string, unknown>; loop?: LoopContext }
  | { type: 'COMMENT_POSTED';   workspaceId: string; projectId: string; taskId: string; actorId: string; commentId: string; payload?: Record<string, unknown>; loop?: LoopContext };

export type LoopDecision = { ok: true } | { ok: false; reason: 'depth' | 'chain' };

/** Pure loop-guard decision for one rule given the inbound causal context. */
export function shouldEnqueue(ruleId: string, loop: LoopContext): LoopDecision {
  if (loop.depth >= MAX_DEPTH)              return { ok: false, reason: 'depth' };
  if (loop.causationChain.includes(ruleId)) return { ok: false, reason: 'chain' };
  return { ok: true };
}

export const cooldownKey = (ruleId: string, entityId: string): string =>
  `automation:cooldown:${ruleId}:${entityId}`;

/** Returns true at most once per COOLDOWN_SECONDS for a (rule,entity). Fails OPEN. */
async function passCooldown(ruleId: string, entityId: string): Promise<boolean> {
  try {
    const res = await getRedis().set(cooldownKey(ruleId, entityId), '1', 'EX', COOLDOWN_SECONDS, 'NX');
    return res === 'OK';
  } catch {
    return true;
  }
}

/**
 * Resolve scope-matching enabled rules for a domain event and enqueue one job
 * per surviving rule. Best-effort: never throws into the caller (mirrors
 * publishTaskEvent). The loop guard drops self-retriggering / too-deep enqueues
 * and records a `loop_blocked` run for visibility.
 */
export async function emitAutomationEvent(event: AutomationDomainEvent): Promise<void> {
  const loop: LoopContext = event.loop ?? { depth: 0, causationChain: [] };
  try {
    const rules = await repo.getByTrigger(event.projectId, event.workspaceId, event.type);
    const payload = { taskId: event.taskId, ...(event.payload ?? {}), ...buildEventPayload(event) };

    for (const rule of rules) {
      const decision = shouldEnqueue(rule.id, loop);
      if (!decision.ok) {
        // Audit the blocked attempt without enqueuing.
        await repo.recordRun({
          ruleId: rule.id, workspaceId: rule.workspaceId, projectId: rule.projectId,
          triggerType: event.type, status: 'loop_blocked',
          payload: JSON.stringify(payload), depth: loop.depth, startedAt: new Date(),
        }).catch(() => {});
        continue;
      }
      if (!(await passCooldown(rule.id, event.taskId))) continue;

      await automationQueue.add(`${event.type}:${rule.id}`, {
        ruleId:         rule.id,
        projectId:      rule.projectId,
        workspaceId:    rule.workspaceId,
        eventType:      event.type,
        payload,
        depth:          loop.depth,
        causationChain: loop.causationChain,
      });
    }
  } catch (err: any) {
    log.warn({ err: err?.message, type: event.type }, 'emitAutomationEvent failed');
  }
}

/** Flatten event-specific old/new values into the worker payload. */
function buildEventPayload(event: AutomationDomainEvent): Record<string, unknown> {
  switch (event.type) {
    case 'STATUS_CHANGED':   return { actorId: event.actorId, reporterId: event.reporterId ?? null, fromStatus: event.fromStatus, toStatus: event.toStatus, status: event.toStatus };
    case 'FIELD_CHANGED':    return { actorId: event.actorId, field: event.field, from: event.from, to: event.to };
    case 'ASSIGNEE_CHANGED': return { actorId: event.actorId, from: event.from, to: event.to, assigneeId: event.to };
    case 'COMMENT_POSTED':   return { actorId: event.actorId, commentId: event.commentId };
    case 'TASK_CREATED':     return { actorId: event.actorId, reporterId: event.reporterId ?? null };
    default:                 return {};
  }
}
