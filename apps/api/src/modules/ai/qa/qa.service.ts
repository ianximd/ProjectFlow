import { RetrievalService, retrievalService } from '../retrieval/retrieval.service.js';
import { AiGatewayService } from '../gateway/ai-gateway.service.js';
import type { AiScopeType } from '../index/index.repository.js';
import { buildAskPrompt, parseCitations } from './qa.prompt.js';

export interface Citation {
  objectType: string;
  objectId: string;
}

export interface AskResult {
  answer: string;
  citations: Citation[];
}

/**
 * Stateless Q&A orchestration (v1, no multi-turn memory): retrieve permission-
 * scoped chunks → build a numbered-source prompt → gateway.complete → parse the
 * cited indices back to object refs. Citations are derived ONLY from the already
 * permission-filtered retrieved sources, so a citation can never resolve to an
 * object the user cannot VIEW (spec §4.3).
 */
export class QaService {
  constructor(
    private retrieval: RetrievalService = retrievalService,
    private gateway: AiGatewayService = new AiGatewayService(),
  ) {}

  async ask(
    userId: string,
    workspaceId: string,
    question: string,
    scope?: { type: string; id: string },
  ): Promise<AskResult> {
    const chunks = await this.retrieval.retrieve(userId, workspaceId, question, {
      scope: scope ? { scopeType: scope.type as AiScopeType, scopeId: scope.id } : undefined,
      k: 8,
    });
    const { prompt, sources } = buildAskPrompt(question, chunks);
    const { text } = await this.gateway.complete(
      { workspaceId, userId, feature: 'qa' },
      { prompt, sources },
    );
    const citations = parseCitations(text, sources); // ⊆ already-permission-filtered sources
    return { answer: text, citations };
  }
}

export const qaService = new QaService();
