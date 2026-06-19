/**
 * RetrievalService — hybrid (keyword LIKE + semantic cosine) retrieval with a
 * TWO-LAYER permission filter (Phase 11a, Task 8).
 *
 * Flow (per plan §4.1):
 *   1. keywordCandidates + semanticCandidates — both JOIN
 *      usp_AccessibleScopes_ForUser, so they are ALREADY ACL-pre-filtered
 *      (LAYER 1, performance / candidate-set narrowing).
 *   2. reciprocalRankFusion fuses the two ranked id-lists into one ranking.
 *   3. loadChunks hydrates the top fused ids (order is arbitrary from the DB).
 *   4. AUTHORITATIVE per-result re-check via accessService.can(... 'VIEW')
 *      (LAYER 2, defense in depth) — this is the real guarantee. The fusion
 *      ranking is preserved when iterating so the returned top-k are the
 *      best-ranked ALLOWED chunks (we don't let loadChunks' DB order discard
 *      good results when we break at k).
 *
 * Layer 1 is performance; Layer 2 is correctness. If the SP ever drifted from
 * the resolver, Layer 2 would still never leak a denied chunk.
 */

import { IndexRepository } from '../index/index.repository.js';
import type { ChunkRow, AiObjectType, AiScopeType } from '../index/index.repository.js';
import { reciprocalRankFusion } from './fusion.js';
import { makeEmbedder } from './voyage.embedder.js';
import type { Embedder } from './embedder.types.js';
import { accessService } from '../../access/access.service.js';

/** A chunk returned to callers (Task 10's route returns this; 11b consumes it). */
export interface RetrievedChunk {
  id: string;
  objectType: AiObjectType;
  objectId: string;
  scopeType: AiScopeType;
  scopeId: string;
  content: string;
}

/** Per-result VIEW authority check. Mirrors accessService.can's signature so the
 *  real singleton is a drop-in default, but it's injectable for unit tests. */
export type AccessChecker = (
  userId: string,
  scopeType: AiScopeType,
  scopeId: string,
) => Promise<boolean>;

export interface RetrieveOpts {
  /** Restrict candidate generation to a single scope. */
  scope?: { scopeType: AiScopeType; scopeId: string };
  /** Number of chunks to return after the Layer-2 filter (default 8). */
  k?: number;
  /** Restrict to one object kind. */
  kind?: AiObjectType;
}

export class RetrievalService {
  private readonly can: AccessChecker;

  constructor(
    private indexRepo: IndexRepository = new IndexRepository(),
    private embedder: Embedder = makeEmbedder(),
    accessChecker?: AccessChecker,
  ) {
    // Default to the real authoritative resolver; tests may inject a fake.
    this.can = accessChecker
      ?? ((userId, scopeType, scopeId) => accessService.can(userId, scopeType, scopeId, 'VIEW'));
  }

  async retrieve(
    userId: string,
    workspaceId: string,
    query: string,
    opts: RetrieveOpts = {},
  ): Promise<RetrievedChunk[]> {
    const k = opts.k ?? 8;
    const candidateOpts = { scope: opts.scope, kind: opts.kind };

    // LAYER 1: both candidate queries are ACL-pre-filtered by the SP.
    const kw = await this.indexRepo.keywordCandidates(workspaceId, query, userId, candidateOpts);
    const [qvec] = await this.embedder.embed([query]);
    const sem = await this.indexRepo.semanticCandidates(workspaceId, qvec, userId, candidateOpts);

    // Fuse the two ranked id-lists; take a generous head (k*2) so the Layer-2
    // filter has spare candidates if some are denied.
    const fusedIds = reciprocalRankFusion([kw.map((r) => r.id), sem.map((r) => r.id)]).slice(0, k * 2);
    if (fusedIds.length === 0) return [];

    // Hydrate (DB order is arbitrary) then re-order by fusion rank so the
    // top-k returned are the best-ranked allowed chunks.
    const chunks = await this.indexRepo.loadChunks(workspaceId, fusedIds);
    const byId = new Map<string, ChunkRow>(chunks.map((c) => [c.id, c]));
    const ranked = fusedIds.map((id) => byId.get(id)).filter((c): c is ChunkRow => c !== undefined);

    // LAYER 2 (authoritative): drop anything can() denies; stop once we have k.
    const allowed: RetrievedChunk[] = [];
    for (const c of ranked) {
      if (await this.can(userId, c.scopeType, c.scopeId)) {
        allowed.push({
          id: c.id,
          objectType: c.objectType,
          objectId: c.objectId,
          scopeType: c.scopeType,
          scopeId: c.scopeId,
          content: c.content,
        });
      }
      if (allowed.length >= k) break;
    }
    return allowed;
  }
}

export const retrievalService = new RetrievalService();
