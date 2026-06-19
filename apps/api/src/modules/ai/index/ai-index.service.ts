/**
 * ai-index.service — fire-and-forget enqueue facade for the AI indexing pipeline
 * (Phase 11a).
 *
 * The task/comment/docs services call these alongside their existing side-effect
 * emissions. Both methods MUST FAIL OPEN: a Redis/queue outage can never throw
 * into the caller's mutation path — the worst case is a chunk that's stale until
 * the next edit (or a future backfill).
 *
 * Debounce: rapid edits to the same object coalesce via debounceGate (Redis SET
 * NX EX, 30s). The gate itself fails open (enqueues) when Redis is unavailable.
 */

import { debounceGate } from '../../notifications/fanout.js';
import { subLogger } from '../../../shared/lib/logger.js';
import { getAiIndexQueue } from './ai-index.queue.js';
import type { AiObjectType } from './index.repository.js';

const log = subLogger('ai-index-service');

const DEBOUNCE_TTL_SECONDS = 30;

async function enqueue(
  workspaceId: string, objectType: AiObjectType, objectId: string, op: 'upsert' | 'delete',
): Promise<void> {
  try {
    // Coalesce bursts of the SAME op on the SAME object. A delete and an upsert
    // get different gate keys so a delete is never swallowed by a prior upsert.
    const gateKey = `ai:index:${op}:${objectType}:${objectId}`;
    if (!(await debounceGate(gateKey, DEBOUNCE_TTL_SECONDS))) return;

    await getAiIndexQueue().add(
      op,
      { workspaceId, objectType, objectId, op },
      // jobId collapses any not-yet-processed duplicate for this (op,object) into
      // one queued job — a second layer of de-dup beyond the time gate.
      { jobId: `${op}:${objectType}:${objectId}` },
    );
  } catch (err: any) {
    // FAIL OPEN — never fault the caller's mutation.
    log.warn({ err: err?.message, objectType, objectId, op }, 'ai-index enqueue failed (swallowed)');
  }
}

export const aiIndexService = {
  enqueueIndex(workspaceId: string, objectType: AiObjectType, objectId: string): Promise<void> {
    return enqueue(workspaceId, objectType, objectId, 'upsert');
  },
  enqueueDelete(workspaceId: string, objectType: AiObjectType, objectId: string): Promise<void> {
    return enqueue(workspaceId, objectType, objectId, 'delete');
  },
};
